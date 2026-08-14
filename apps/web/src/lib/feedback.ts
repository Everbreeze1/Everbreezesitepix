import { supabase } from "@/integrations/sitepix/client";

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
}

export async function submitFeedback(input: SubmitFeedbackInput): Promise<void> {
  const { error } = await supabase.from("issue_reports").insert({
    user_id: input.userId ?? null,
    email: input.email ?? null,
    // The table's text column is `description` - NOT `message`, whatever the
    // generated types used to say. See 20260803040000.
    description: (input.message ?? "").trim().slice(0, 4000),
    kind: input.kind,
    feature: input.feature ?? null,
    sentiment: input.sentiment ?? null,
    source: input.source,
    url: typeof window !== "undefined" ? window.location.href : null,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
  });
  if (error) throw new Error(error.message);
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

const storeKey = (userId: string) => `sitepix:feedback:v1:${userId}`;
const SESSION_FLAG = "sitepix:feedback:session-counted";

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
