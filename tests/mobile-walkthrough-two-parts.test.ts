import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aiSummaryLabel,
  aiSummaryStatus,
  clockDuration,
  photoOnlySummaries,
  recordedBy,
  summariesByWalkthrough,
  summaryFirstLine,
  summarySections,
} from "../apps/mobile/src/api/walkthrough-list-view";

/*
 * A walkthrough is two things: the video, and the AI Summary written from what
 * was said on it. Jon, testing the Android build, found the Walkthroughs tab
 * did not make that apparent. These pin the pairing and the wording the cards
 * and the detail screen are built on.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const summary = (over: Partial<Parameters<typeof summariesByWalkthrough>[0][number]> = {}) => ({
  id: "s1",
  walkthroughId: "w1",
  status: "ready",
  markdown: "## Overview\n\nReplaced the condenser fan motor.",
  createdAt: "2026-09-01T10:00:00Z",
  ...over,
});

describe("pairing a recording with its summary", () => {
  it("keeps the newest summary of each recording", () => {
    const pairs = summariesByWalkthrough([
      summary({ id: "old", createdAt: "2026-09-01T10:00:00Z" }),
      summary({ id: "new", createdAt: "2026-09-02T10:00:00Z" }),
      summary({ id: "other", walkthroughId: "w2" }),
    ]);
    expect(pairs.get("w1")?.id).toBe("new");
    expect(pairs.get("w2")?.id).toBe("other");
  });

  it("leaves summaries written from photos out of the pairing", () => {
    const list = [summary(), summary({ id: "photos", walkthroughId: null })];
    expect(summariesByWalkthrough(list).size).toBe(1);
    expect(photoOnlySummaries(list).map((s) => s.id)).toEqual(["photos"]);
  });
});

describe("the AI Summary status", () => {
  it("is Ready once there is a body to read", () => {
    expect(aiSummaryStatus({ status: "ready" }, summary())).toBe("ready");
    // A body beats a stale pending status.
    expect(aiSummaryStatus({ status: "ready" }, summary({ status: "pending" }))).toBe("ready");
  });

  it("is Generating while either the recording or the row is still being written", () => {
    expect(aiSummaryStatus({ status: "generating" }, null)).toBe("generating");
    expect(
      aiSummaryStatus({ status: "ready" }, summary({ status: "pending", markdown: null })),
    ).toBe("generating");
  });

  it("is Not generated for a finished recording with no summary", () => {
    expect(aiSummaryStatus({ status: "ready" }, null)).toBe("none");
    expect(aiSummaryLabel("none")).toBe("Not generated");
    expect(aiSummaryLabel("ready")).toBe("Ready");
    expect(aiSummaryLabel("generating")).toBe("Generating");
  });

  it("is Failed when the write-up failed", () => {
    expect(
      aiSummaryStatus({ status: "ready" }, summary({ status: "failed", markdown: null })),
    ).toBe("failed");
  });
});

describe("what the card and the report show", () => {
  it("previews the first line of prose, not a heading", () => {
    expect(summaryFirstLine("# Title\n\n## Overview\n\n**Replaced** the fan.")).toBe(
      "Replaced the fan.",
    );
    expect(summaryFirstLine(null)).toBe("");
    expect(summaryFirstLine(`## Findings\n\n- ${"x".repeat(200)}`, 20)).toHaveLength(20);
  });

  it("splits the write-up into its headed sections and drops the title", () => {
    const sections = summarySections(
      "# Job - Summary\n\n## Overview\n\nAll good.\n\n## Findings\n\n- Fan replaced\n- Filter dirty",
    );
    expect(sections.map((s) => s.heading)).toEqual(["Overview", "Findings"]);
    expect(sections[0].body).toBe("All good.");
    expect(sections[1].body).toContain("Filter dirty");
    expect(summarySections("")).toEqual([]);
  });

  it("says who recorded it, or nothing", () => {
    const names = new Map([["u2", "Gumaro"]]);
    expect(recordedBy("u1", "u1", names)).toBe("You");
    expect(recordedBy("u2", "u1", names)).toBe("Gumaro");
    expect(recordedBy("u3", "u1", names)).toBeNull();
    expect(recordedBy(null, "u1", names)).toBeNull();
  });

  it("gives the duration as a clock", () => {
    expect(clockDuration(245)).toBe("4:05");
    expect(clockDuration(0)).toBe("");
    expect(clockDuration(null)).toBe("");
  });
});

describe("the screens are wired to both halves", () => {
  it("the list card offers the video and the summary as separate actions", () => {
    const card = read("apps/mobile/src/components/walkthrough/WalkthroughCard.tsx");
    expect(card).toContain('label="Watch video"');
    expect(card).toContain('"Read summary"');
    expect(card).toContain("AI Summary");
  });

  it("the detail screen puts Summary and Transcript under the player", () => {
    const s = read("apps/mobile/app/(app)/walkthrough/[id].tsx");
    expect(s.indexOf("<VideoView")).toBeGreaterThan(-1);
    expect(s.indexOf("<SegmentTabs")).toBeGreaterThan(s.indexOf("<VideoView"));
    expect(s).toContain('label: "Summary"');
    expect(s).toContain('label: "Transcript"');
    expect(s).toContain("generateSummaryForWalkthrough");
  });

  it("regenerates through the op the service accepts for a recorded walk", () => {
    /*
     * `regenerateWalkthroughSummary` refuses any recorded walk, so the write-up
     * screen's "Write it again" could only fail. The forced generate is what
     * the web uses.
     */
    const service = read("apps/api/src/domains/walkthroughs/service.ts");
    expect(service).toContain("This walkthrough was recorded - use Regenerate report instead.");
    const screen = read("apps/mobile/app/(app)/summary/[summaryId].tsx");
    expect(screen).toContain("generateSummaryForWalkthrough(summary?.walkthroughId");
    expect(screen).not.toContain("regenerateSummary(");
  });
});
