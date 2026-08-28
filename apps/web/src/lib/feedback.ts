import { supabase } from "@/integrations/everlumen/client";
import { isPendingMigrationError } from "@/lib/supabase-errors";
import { summarizeClient, type ClientContext } from "@/lib/feedback-context";

export type FeedbackKind = "bug" | "idea" | "praise";
export type FeedbackSentiment = "good" | "bad";
export type FeedbackSource = "page" | "prompt";

export interface SubmitFeedbackInput {
  kind: FeedbackKind;
  message?: string;
  /** Which surface this is about - the axis the whole thing gets grouped by. */
  feature?: string | null;
  sentiment?: FeedbackSentiment | null;
  source: FeedbackSource;
  userId?: string | null;
  email?: string | null;
  /** Optional, and only ever the project's id - no photos, documents or notes. */
  projectId?: string | null;
  /** Browser/OS/screen, read from the browser rather than typed by the reporter. */
  client?: ClientContext | null;
  /** Storage paths in the `feedback-attachments` bucket, uploaded before this call. */
  attachments?: string[] | null;
}

/**
 * The structured half of a report, rendered back into text.
 *
 * Used only by the fallback in `submitFeedback`: if the columns these values
 * belong in are not on the table yet, the context is appended to the
 * description rather than dropped. A report that arrives slightly untidy beats
 * one that arrives with the device details missing.
 */
function contextAsText(input: SubmitFeedbackInput): string {
  const lines: string[] = [];
  if (input.projectId) lines.push(`Project: ${input.projectId}`);
  if (input.client) {
    lines.push(
      `Device: ${summarizeClient(input.client)}`,
      `Screen: ${input.client.screen} (window ${input.client.viewport})`,
      `Time zone: ${input.client.timezone}`,
    );
  }
  if (input.attachments?.length) lines.push(`Attachments: ${input.attachments.join(", ")}`);
  return lines.length ? `\n\n---\n${lines.join("\n")}` : "";
}

/** The columns `issue_reports` has had since 20260803020000. */
function baseRow(input: SubmitFeedbackInput, description: string) {
  return {
    user_id: input.userId ?? null,
    email: input.email ?? null,
    // The table's text column is `description` - NOT `message`, whatever the
    // generated types used to say. See 20260803040000.
    description: description.slice(0, 4000),
    kind: input.kind,
    feature: input.feature ?? null,
    sentiment: input.sentiment ?? null,
    source: input.source,
    url: typeof window !== "undefined" ? window.location.href : null,
    user_agent: input.client?.userAgent
      ? input.client.userAgent.slice(0, 500)
      : typeof navigator !== "undefined"
        ? navigator.userAgent.slice(0, 500)
        : null,
  };
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<void> {
  const description = (input.message ?? "").trim();

  const { error } = await supabase.from("issue_reports").insert({
    ...baseRow(input, description),
    project_id: input.projectId ?? null,
    client_info: input.client ?? null,
    attachments: input.attachments?.length ? input.attachments : null,
  });
  if (!error) return;

  /*
   * Migrations here are applied by hand, so there is a real window where the
   * three columns above are not on the table yet (see 20260921000000). Losing a
   * bug report to that would be the worst outcome for the one page whose job is
   * receiving them, so retry once with the long-standing columns and fold the
   * structured context into the text.
   */
  if (!isPendingMigrationError(error)) throw new Error(error.message);

  const { error: retryError } = await supabase
    .from("issue_reports")
    .insert(baseRow(input, `${description}${contextAsText(input)}`));
  if (retryError) throw new Error(retryError.message);
}

// ---------------------------------------------------------------------------
// The reporter's own reports
// ---------------------------------------------------------------------------

/** Mirrors FEEDBACK_STATUSES in apps/api/src/domains/admin/feedback.ts. */
export type FeedbackStatus = "new" | "triaged" | "resolved" | "dismissed";

const FEEDBACK_STATUSES: FeedbackStatus[] = ["new", "triaged", "resolved", "dismissed"];

export interface MyFeedbackReport {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  description: string;
  feature: string | null;
  createdAt: string;
}

/**
 * Everything this account has filed, newest first.
 *
 * `issue_reports` has let a reporter read their own rows since 20260803020000
 * ("Users view own issue reports") and nothing ever did. So a report vanished
 * the moment it was sent: triage moves `status` in the admin console, and the
 * person who filed it had no surface anywhere that showed the move. This is the
 * reader for the half of the loop that was never built.
 *
 * `user_id` is filtered here as well as by the policy, so the query is a lookup
 * rather than a scan the policy then throws most of away.
 *
 * Text only. A one-tap thumbs signal from the in-app prompt is feedback, but it
 * carries no message and gets no reply, so listing those back would pad this
 * with rows that say nothing and never change.
 */
export async function listMyFeedback(userId: string): Promise<MyFeedbackReport[]> {
  const { data, error } = await supabase
    .from("issue_reports")
    .select("id, kind, status, description, feature, created_at")
    .eq("user_id", userId)
    .not("description", "is", null)
    .neq("description", "")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);

  return ((data as any[]) ?? []).map((row) => ({
    id: row.id as string,
    kind: (row.kind ?? "bug") as FeedbackKind,
    /*
     * The column had no CHECK constraint until 20260822130000, so a row older
     * than that is not guaranteed to hold one of the four. Falling back to
     * "new" beats rendering an empty badge.
     */
    status: FEEDBACK_STATUSES.includes(row.status) ? (row.status as FeedbackStatus) : "new",
    description: (row.description as string | null) ?? "",
    feature: (row.feature as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const FEEDBACK_BUCKET = "feedback-attachments";
/** Screenshots, not site photography. Big enough for a full-page grab. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;
export const ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";

function safeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (cleaned || "attachment").slice(-80);
}

/**
 * Uploads at send time rather than at file-pick time.
 *
 * Picking a file is not a commitment to send, and a bucket full of screenshots
 * from reports nobody finished would be nobody's job to clean up.
 *
 * Never throws. A failed upload must not swallow the report that came with it,
 * so the caller sends the text regardless and tells the user which files did
 * not make it.
 */
export async function uploadFeedbackAttachments(
  userId: string,
  files: File[],
): Promise<{ paths: string[]; failed: string[] }> {
  const paths: string[] = [];
  const failed: string[] = [];
  const stamp = Date.now();

  for (const [i, file] of files.entries()) {
    const path = `${userId}/${stamp}-${i}-${safeName(file.name)}`;
    try {
      const { error } = await supabase.storage
        .from(FEEDBACK_BUCKET)
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) throw error;
      paths.push(path);
    } catch {
      failed.push(file.name);
    }
  }
  return { paths, failed };
}

// ---------------------------------------------------------------------------
// Prompt funnel telemetry
// ---------------------------------------------------------------------------

export type PromptEvent = "shown" | "dismissed" | "answered";

/**
 * Records what happened to a prompt so response/dismissal rates have a
 * denominator - a dismissal count without impressions isn't a rate.
 *
 * Fire-and-forget by design: this is disposable telemetry, so a failure here
 * (offline, RLS, migration not applied yet) must never surface to the user or
 * block the thing they were actually doing. Callers do not await it.
 */
export function logPromptEvent(userId: string, feature: string, event: PromptEvent): void {
  void (async () => {
    try {
      await supabase
        .from("feedback_prompt_events" as never)
        .insert({ user_id: userId, feature, event } as never);
    } catch {
      /* telemetry is never worth an error in front of the user */
    }
  })();
}

// ---------------------------------------------------------------------------
// Which surface is the user on?
// ---------------------------------------------------------------------------

/** Ordered most-specific-first; the first match wins. */
const FEATURE_ROUTES: Array<{ test: RegExp; key: string; label: string }> = [
  { test: /^\/projects\/[^/]+\/pages\//, key: "documents", label: "Documents" },
  { test: /^\/projects\/[^/]+\/reports\//, key: "report_builder", label: "the report builder" },
  // `key` is written to issue_reports.feature and feedback_prompt_events -
  // renaming it would split the existing telemetry, so only the label moves.
  { test: /^\/showcases\/[^/]+/, key: "showcases", label: "Portfolio" },
  { test: /^\/showcases/, key: "showcases", label: "Portfolio" },
  { test: /^\/walkthroughs\//, key: "walkthroughs", label: "Walkthroughs" },
  { test: /^\/templates/, key: "templates", label: "Templates" },
  { test: /^\/gallery/, key: "gallery", label: "the Gallery" },
  { test: /^\/map/, key: "maps", label: "Maps" },
  { test: /^\/projects\/[^/]+/, key: "project_detail", label: "your project workspace" },
  { test: /^\/projects/, key: "projects", label: "Projects" },
  { test: /^\/dashboard/, key: "dashboard", label: "your dashboard" },
];

/** Surfaces where a prompt would be rude or nonsensical. */
const EXCLUDED = [/^\/report-issue/, /^\/pricing/, /^\/settings/, /^\/share\//, /^\/login/];

export function featureForPath(pathname: string): { key: string; label: string } | null {
  if (EXCLUDED.some((re) => re.test(pathname))) return null;
  const hit = FEATURE_ROUTES.find((f) => f.test.test(pathname));
  return hit ? { key: hit.key, label: hit.label } : null;
}

// ---------------------------------------------------------------------------
// Cadence
//
// The rules the prompt has to respect, in the client's words: "maybe not too
// often but conveniently remind … if they x out of it then don't suggest maybe
// for next log in or two."
// ---------------------------------------------------------------------------

/** Dismissing skips this many future sessions ("the next log in or two"). */
const DISMISS_SESSIONS = 2;
/** Minimum gap between prompts about anything, so it never feels naggy. */
const COOLDOWN_DAYS = 3;
/** Time on a surface before asking - enough that they've actually used it. */
export const DWELL_MS = 25_000;

interface FeedbackState {
  sessionCount: number;
  resumeAtSession: number;
  lastPromptAt: string | null;
  /** featureKey -> ISO. An answered feature is never asked about again. */
  answered: Record<string, string>;
}

const EMPTY: FeedbackState = {
  sessionCount: 0,
  resumeAtSession: 0,
  lastPromptAt: null,
  answered: {},
};

const storeKey = (userId: string) => `everlumen:feedback:v1:${userId}`;
const SESSION_FLAG = "everlumen:feedback:session-counted";

function read(userId: string): FeedbackState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(storeKey(userId));
    if (!raw) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<FeedbackState>) };
  } catch {
    return { ...EMPTY };
  }
}

function write(userId: string, state: FeedbackState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storeKey(userId), JSON.stringify(state));
  } catch {
    /* private mode / quota - the prompt is optional, never break the app for it */
  }
}

/**
 * Counts this browser session exactly once. sessionStorage is the closest
 * proxy we have for "a log in" without wiring into auth events: it is cleared
 * when the tab/browser closes but survives navigation within the session.
 */
export function beginFeedbackSession(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(SESSION_FLAG)) return;
    window.sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {
    return;
  }
  const state = read(userId);
  write(userId, { ...state, sessionCount: state.sessionCount + 1 });
}

export function canPrompt(userId: string, featureKey: string): boolean {
  const state = read(userId);
  if (state.answered[featureKey]) return false;
  if (state.sessionCount < state.resumeAtSession) return false;
  if (state.lastPromptAt) {
    const elapsedDays = (Date.now() - new Date(state.lastPromptAt).getTime()) / 86_400_000;
    if (elapsedDays < COOLDOWN_DAYS) return false;
  }
  return true;
}

export function markPromptShown(userId: string): void {
  const state = read(userId);
  write(userId, { ...state, lastPromptAt: new Date().toISOString() });
}

/** X'd out: hold off for the next couple of sessions. */
export function markPromptDismissed(userId: string): void {
  const state = read(userId);
  write(userId, { ...state, resumeAtSession: state.sessionCount + DISMISS_SESSIONS });
}

export function markFeatureAnswered(userId: string, featureKey: string): void {
  const state = read(userId);
  write(userId, {
    ...state,
    answered: { ...state.answered, [featureKey]: new Date().toISOString() },
  });
}
