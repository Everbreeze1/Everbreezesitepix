import { api } from "@/lib/api";

/**
 * The Daily Log.
 *
 * The technician's own record, and the one AI artefact in this product that
 * nobody asks for: a walkthrough summary and a client report are things you go
 * and generate, whereas the Daily Log is supposed to be there already when you
 * look. The server has done the work since long before the app existed, and the
 * phone, which is where capture actually happens, never called it once.
 *
 * The trigger lives in `src/offline/capture-session.ts`, because on a phone a
 * capture session finishes when the outbox finishes, not when the camera
 * closes.
 */

/** Mirrors `DailyLogSummary` in `apps/api/src/domains/projects/daily-log.ts`. */
export type DailyLogSummary = {
  pageId: string;
  title: string;
  /**
   * An absolute instant, and deliberately not a day.
   *
   * The server refuses to say which calendar day a log belongs to, because it
   * cannot know whose calendar. The phone resolves it against its own clock,
   * which is the technician's, which is the one that matters.
   */
  createdAt: string;
  updatedAt: string;
  /** Bullets across the whole day, oldest section first. */
  entries: string[];
  photoCount: number;
};

export type AutoDailyLogResult = {
  pageId: string;
  title: string;
  updatedAt: string;
  created: boolean;
  entries: string[];
  photoCount: number;
  /** Non-null when the AI was unavailable and the section fell back to a stub. */
  aiFailed: string | null;
};

export async function autoDailyLog(input: {
  projectId: string;
  photoIds: string[];
  source?: "camera" | "upload";
  tzOffsetMinutes?: number;
  /**
   * A stable key for this exact batch, so a retry cannot append twice.
   *
   * Load-bearing here in a way it is not on the web. The browser calls this
   * once, in the foreground, with somebody watching. The phone calls it from a
   * background drain that retries whenever the previous attempt did not visibly
   * succeed, and "did not visibly succeed" includes a response lost on a
   * failing connection after the server had already written the section. The op
   * is registered `{ idempotent: true }`, so a repeat under the same key
   * replays the first result instead of appending a second copy of the day.
   */
  idempotencyKey?: string;
}): Promise<AutoDailyLogResult> {
  return api.rpc<AutoDailyLogResult>(
    "autoDailyLog",
    {
      projectId: input.projectId,
      photoIds: input.photoIds,
      source: input.source,
      tzOffsetMinutes: input.tzOffsetMinutes,
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
}

export async function listProjectDailyLogs(projectId: string): Promise<DailyLogSummary[]> {
  const result = await api.rpc<DailyLogSummary[]>("listProjectDailyLogs", { projectId });
  // The service returns the array itself rather than wrapping it, unlike most
  // ops here. Guarded anyway: a shape mismatch should render empty, not throw.
  return Array.isArray(result) ? result : [];
}
