/**
 * Turning a walkthrough into a client report.
 *
 * Import-free so the wording can be tested, and the wording is the whole of it:
 * the op is idempotent by lookup rather than by key, so the same tap twice
 * produces the same report and the screen must not claim otherwise.
 */

/** What the service answers with. */
export type WalkthroughReportResult = {
  reportId: string | null;
  alreadyExisted: boolean;
};

/**
 * What to say after the tap.
 *
 * The two cases are genuinely different and reporting them the same way is a
 * small lie that costs trust: somebody who taps twice and is told "Report
 * created" twice reasonably concludes they now have two reports to go and
 * delete.
 */
export function reportResultMessage(result: WalkthroughReportResult): string {
  if (!result.reportId) {
    return "The report could not be created.";
  }
  return result.alreadyExisted
    ? "This walkthrough already had a report. Opening it."
    : "Report created from this walkthrough.";
}

/**
 * Why the button is dead, or null.
 *
 * A transcript is what the report is written from, and the existing Generate
 * report button already refuses without one for the same reason. Saying so up
 * front beats spending a Pro quota slot to be told no.
 */
export function reportRefusal(hasTranscript: boolean): string | null {
  return hasTranscript ? null : "A client report needs a transcript first.";
}

/**
 * Whether there is anything to open after the call.
 *
 * Separate from the message because the screen navigates on this and speaks on
 * the other, and a missing id with a cheerful message would push a route with
 * `undefined` in it.
 */
export function canOpenReport(result: WalkthroughReportResult): boolean {
  return Boolean(result.reportId);
}
