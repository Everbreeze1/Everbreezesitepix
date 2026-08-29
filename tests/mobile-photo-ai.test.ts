import { describe, expect, it } from "vitest";
import {
  analysisSummary,
  isAnalysisEmpty,
  severityLabel,
  severityOf,
  sortDefects,
  usableDefects,
  usableLabels,
  usableOcr,
  usableRecommendations,
  type PhotoAnalysis,
} from "../apps/mobile/src/api/photo-ai-view";

/*
 * Reading an AI analysis.
 *
 * Every field in an `ai_analyses` row is written by a language model, which
 * makes every field optional in practice whatever the column says. A run can
 * complete with no defects, no recommendations, an empty report and a severity
 * word nobody has seen before, and a screen that assumes otherwise crashes on
 * the first photo of a clean wall.
 */

const analysis = (over: Partial<PhotoAnalysis> = {}): PhotoAnalysis => ({
  id: "a1",
  photo_id: "p1",
  status: "completed",
  ocr_text: null,
  labels: null,
  defects: null,
  report_text: null,
  recommendations: null,
  created_at: "2026-08-29T10:00:00.000Z",
  ...over,
});

describe("severityOf", () => {
  it("reads the words the model actually uses", () => {
    expect(severityOf({ severity: "High" })).toBe("high");
    expect(severityOf({ severity: "CRITICAL" })).toBe("high");
    expect(severityOf({ severity: "  urgent  " })).toBe("high");
    expect(severityOf({ severity: "moderate" })).toBe("medium");
    expect(severityOf({ severity: "Minor" })).toBe("low");
    expect(severityOf({ severity: "cosmetic" })).toBe("low");
  });

  it("reads a severity buried in a sentence", () => {
    // The model is asked for a word and sometimes returns a phrase.
    expect(severityOf({ severity: "Low - surface rust only" })).toBe("low");
  });

  it("treats an unknown word as medium, never high", () => {
    /*
     * High is the colour that makes somebody stop work, so it has to mean the
     * model said so. Defaulting an unparsed word to high turns every quirk of
     * phrasing into a red flag, and a red flag that is usually wrong gets
     * ignored inside a week.
     */
    expect(severityOf({ severity: "spicy" })).toBe("medium");
    expect(severityOf({ severity: null })).toBe("medium");
    expect(severityOf({})).toBe("medium");
  });
});

describe("sortDefects", () => {
  it("puts the worst first", () => {
    // A phone shows three defects before the fold. In the model's own order the
    // one that matters is as likely to be fourth as first.
    const sorted = sortDefects([
      { description: "c", severity: "low" },
      { description: "a", severity: "critical" },
      { description: "b", severity: "moderate" },
    ]);
    expect(sorted.map((d) => d.description)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { description: "c", severity: "low" },
      { description: "a", severity: "high" },
    ];
    sortDefects(input);
    expect(input[0].description).toBe("c");
  });
});

describe("usableDefects", () => {
  it("drops a defect with nothing to say", () => {
    /*
     * A defect with no description renders as a row saying "Medium" and nothing
     * else, and the reader cannot tell whether that is a finding or a bug.
     */
    const out = usableDefects(
      analysis({
        defects: [
          { description: "Corrosion on the bracket", severity: "high" },
          { description: "  ", severity: "high" },
          { severity: "low" },
        ],
      }),
    );
    expect(out).toHaveLength(1);
  });

  it("copes with a defects column that is not an array", () => {
    // It is jsonb. A run that wrote an object, or null, must not crash the
    // screen.
    expect(usableDefects(analysis({ defects: null }))).toEqual([]);
    expect(usableDefects(analysis({ defects: {} as never }))).toEqual([]);
  });
});

describe("usableRecommendations and usableLabels", () => {
  it("drops the blanks", () => {
    expect(
      usableRecommendations(analysis({ recommendations: ["Replace the seal", "  ", ""] })),
    ).toEqual(["Replace the seal"]);
  });

  it("deduplicates labels case-insensitively", () => {
    // The model repeats itself often enough that a chip row of six shows four
    // distinct words.
    expect(usableLabels(analysis({ labels: ["Panel", "panel", "PANEL", "Conduit"] }))).toEqual([
      "Panel",
      "Conduit",
    ]);
  });

  it("keeps the first casing it saw", () => {
    expect(usableLabels(analysis({ labels: ["panel", "Panel"] }))).toEqual(["panel"]);
  });

  it("survives a null column", () => {
    expect(usableLabels(analysis())).toEqual([]);
    expect(usableRecommendations(analysis())).toEqual([]);
  });
});

describe("usableOcr", () => {
  it("keeps the line breaks", () => {
    /*
     * The brand, model and serial the service folds in are one per line.
     * Running them together turns a serial number into part of a sentence.
     */
    expect(usableOcr(analysis({ ocr_text: "Brand: Acme\nModel: X1\nSerial: 99" }))).toBe(
      "Brand: Acme\nModel: X1\nSerial: 99",
    );
  });

  it("drops blank lines and trims each one", () => {
    expect(usableOcr(analysis({ ocr_text: "  Brand: Acme  \n\n\n  Model: X1 \n" }))).toBe(
      "Brand: Acme\nModel: X1",
    );
  });

  it("is null when there was no text", () => {
    expect(usableOcr(analysis({ ocr_text: "   \n  \n" }))).toBeNull();
    expect(usableOcr(analysis({ ocr_text: null }))).toBeNull();
  });
});

describe("isAnalysisEmpty", () => {
  it("is true for a completed run that found nothing", () => {
    // The correct answer for a photo of a clean wall. It has to read as an
    // answer, not as a screen that failed to load.
    expect(isAnalysisEmpty(analysis())).toBe(true);
    expect(
      isAnalysisEmpty(
        analysis({ report_text: "   ", labels: [], defects: [], recommendations: [] }),
      ),
    ).toBe(true);
  });

  it("is false as soon as any one field says something", () => {
    expect(isAnalysisEmpty(analysis({ report_text: "Panel is in good order." }))).toBe(false);
    expect(isAnalysisEmpty(analysis({ ocr_text: "Serial: 99" }))).toBe(false);
    expect(isAnalysisEmpty(analysis({ labels: ["Panel"] }))).toBe(false);
    expect(isAnalysisEmpty(analysis({ recommendations: ["Retorque"] }))).toBe(false);
    expect(isAnalysisEmpty(analysis({ defects: [{ description: "Rust" }] }))).toBe(false);
  });
});

describe("analysisSummary", () => {
  it("distinguishes never-run from ran-and-found-nothing", () => {
    // Two very different things, and collapsing them would have somebody run an
    // analysis that has already been run.
    expect(analysisSummary(null)).toBe("Not analysed yet");
    expect(analysisSummary(analysis())).toBe("Nothing found");
  });

  it("reports the in-flight and failed states", () => {
    expect(analysisSummary(analysis({ status: "processing" }))).toBe("Analysing");
    expect(analysisSummary(analysis({ status: "failed" }))).toBe("Analysis failed");
  });

  it("leads with the high count when there is one", () => {
    /*
     * The only number on this screen anybody acts on immediately. "4 findings"
     * with one critical among them buries the thing that matters.
     */
    expect(
      analysisSummary(
        analysis({
          defects: [
            { description: "a", severity: "critical" },
            { description: "b", severity: "low" },
            { description: "c", severity: "low" },
          ],
        }),
      ),
    ).toBe("1 high severity of 3");
  });

  it("counts findings when none are high", () => {
    expect(analysisSummary(analysis({ defects: [{ description: "a", severity: "minor" }] }))).toBe(
      "1 finding",
    );
    expect(
      analysisSummary(
        analysis({
          defects: [
            { description: "a", severity: "minor" },
            { description: "b", severity: "minor" },
          ],
        }),
      ),
    ).toBe("2 findings");
  });

  it("says so when a run produced a report but no defects", () => {
    expect(analysisSummary(analysis({ report_text: "All in order." }))).toBe("No defects found");
  });
});

describe("severityLabel", () => {
  it("is a word, not a code", () => {
    expect(severityLabel("high")).toBe("High");
    expect(severityLabel("medium")).toBe("Medium");
    expect(severityLabel("low")).toBe("Low");
  });
});
