import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * Where the four artefacts live, asserted on source text.
 *
 * The client repositioned them all at once: Summary became the premium output
 * of recording a walkthrough, Report stayed the client-facing deliverable,
 * Daily Log became an automatic internal record surfaced in the Capture flow,
 * and the raw video walkthrough stopped being listed as a "Summary" in the
 * Reports tab.
 *
 * None of that is enforceable by types - it is which component calls what, and
 * which strings a menu offers. So it is enforced here, the same way the other
 * placement invariants in this repo are. Moving code is fine; moving it without
 * updating these paths is what the test is for.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Strip comments, so a guard cannot match the note explaining itself. */
const stripComments = (src: string) =>
  src.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const GENERATE_MENU = "apps/web/src/features/projects/components/GenerateDocumentMenu.tsx";
const REPORTS_TAB = "apps/web/src/features/projects/components/ProjectReports.tsx";
const PROJECT_PAGE = "apps/web/src/features/projects/pages/ProjectDetailPage.tsx";
const DAILY_LOG_CARD = "apps/web/src/features/projects/components/ProjectDailyLog.tsx";
const PAGE_EDITOR = "apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx";
const DOCUMENTS_TAB = "apps/web/src/features/projects/components/ProjectDocuments.tsx";
const DAILY_LOG_SERVICE = "apps/api/src/domains/projects/daily-log.ts";

describe("Reports holds only the two outward-facing artefacts", () => {
  it("offers no Daily Log in the generation menu", () => {
    // "remove it from the Reports tab's generation list so that tab only
    // contains the two outward-facing, premium artifacts".
    const src = stripComments(read(GENERATE_MENU));
    expect(src).not.toContain("daily_log");
    expect(src).not.toMatch(/>\s*Daily Log\s*</);
  });

  it("still offers both of the artefacts that stayed", () => {
    const src = read(GENERATE_MENU);
    expect(src).toContain("AI Summary");
    expect(src).toMatch(/>\s*Report\s*</);
  });

  it("has no daily-log row kind left in the Reports tab", () => {
    const src = stripComments(read(REPORTS_TAB));
    expect(src).not.toContain("daily_log");
    expect(src).not.toContain("Daily Logs");
  });

  it("keeps the raw video walkthrough out of the Summaries bucket", () => {
    /*
     * The reported bug: "the raw video Walkthrough entry is separately showing
     * up inside the Reports tab miscategorized under the 'Summaries' filter".
     * The predicate has to test `source`, not just the presence of
     * summary_markdown - a generated recording carries that too, which is what
     * dragged it in.
     */
    const src = read(REPORTS_TAB);
    expect(src).toMatch(/export function isReportSummary/);
    expect(src).toMatch(/w\.source === "summary"/);
  });

  it("counts the tab badge with the same predicate the list uses", () => {
    // A count that disagrees with its list sends the user to an empty tab.
    const src = read(PROJECT_PAGE);
    expect(src).toContain("isReportSummary");
    expect(src).not.toMatch(/reportSummaryCount = walkthroughs\.filter\(\s*\(w\) =>\s*w\.status/);
  });
});

describe("Daily Log is automatic, internal, and lives in the Capture flow", () => {
  it("is written from both capture paths, not from a button", () => {
    const src = read(PROJECT_PAGE);
    expect(src).toContain("const runAutoDailyLog");
    // The file picker path and the camera path both finish a capture session.
    expect(src).toMatch(/runAutoDailyLog\(\s*ids\.filter\([\s\S]*?"upload",?\s*\)/);
    expect(src).toContain('runAutoDailyLog(captured, "camera")');
  });

  it("logs a camera session once, not once per shot", () => {
    /*
     * The camera stays open between shots when auto-save is on. Logging inside
     * onCapture spent a model request per photo and split one visit into a
     * column of one-line sections.
     */
    const src = read(PROJECT_PAGE);
    expect(src).toContain("cameraSessionIds.current.push(photoId)");
    expect(src).not.toMatch(/runAutoDailyLog\(\[photoId\]/);
  });

  it("mounts its card on the Photos tab, where capturing happens", () => {
    const src = read(PROJECT_PAGE);
    expect(src).toContain("<ProjectDailyLog");
    expect(src).toContain("generating={dailyLogBusy}");
  });

  it("says internal only in the same words on every surface", () => {
    const notice = "Internal only - not shared with clients";
    // The card, the editor banner, and the page body itself (so the label
    // survives an export to PDF, which is when it matters most).
    expect(read(DAILY_LOG_CARD)).toContain(notice);
    expect(read(DAILY_LOG_SERVICE)).toContain("DAILY_LOG_INTERNAL_NOTICE");
    expect(read(PAGE_EDITOR)).toContain("DAILY_LOG_INTERNAL_NOTICE");
  });

  it("appends to the day's log instead of rewriting it", () => {
    /*
     * The technician can type into their own log. An automatic write that
     * regenerated the body would delete that silently, which is the one thing
     * this document must never do.
     */
    const src = read(DAILY_LOG_SERVICE);
    expect(src).toContain('${existing.content_html ?? ""}${sectionHtml}');
  });

  it("is filtered out of the Documents file manager", () => {
    const src = read(DOCUMENTS_TAB);
    expect(src).toContain('pg.bucket !== "report" && pg.bucket !== "daily_log"');
  });
});

describe("Summary is the premium output of a walkthrough", () => {
  const DETAIL = "apps/web/src/features/walkthroughs/pages/WalkthroughDetailPage.tsx";
  const PLAYER = "apps/web/src/features/walkthroughs/components/WalkthroughNarration.tsx";

  it("plays the recording with its narration rather than a thumbnail dialog", () => {
    const src = read(DETAIL);
    expect(src).toContain("<WalkthroughNarratedPlayer");
    expect(src).toContain("<AiNarratedPhotoSteps");
  });

  it("renders a narrated photo differently from a silent one", () => {
    // "not as a generic photo-caption card that looks the same whether or not
    // anyone spoke during the recording."
    const src = read(PLAYER);
    expect(src).toContain("Heard on camera");
    expect(src).toContain("Nothing was said near this moment.");
    expect(src).toContain("narration.hasSpeech");
  });

  it("carries the AI-narrated treatment", () => {
    expect(read(PLAYER)).toContain("AI narrated");
  });
});

describe("Walkthrough length is capped per take, per tier", () => {
  it("gives Starter 10 minutes, Pro 15 and Team 20", () => {
    const src = read(PROJECT_PAGE);
    const match = src.match(
      /const WALKTHROUGH_MAX_SECONDS: Record<string, number> = \{([\s\S]*?)\};/,
    );
    expect(match).toBeTruthy();
    const table = match![1];
    expect(table).toMatch(/starter:\s*600/);
    expect(table).toMatch(/pro:\s*900/);
    expect(table).toMatch(/team:\s*1200/);
  });

  it("falls back to the smallest cap, not a paid one", () => {
    // An unknown tier must not be handed Team's twenty minutes.
    expect(read(PROJECT_PAGE)).toContain(
      "WALKTHROUGH_MAX_SECONDS[tier] ?? WALKTHROUGH_MAX_SECONDS.starter",
    );
  });
});
