/**
 * Reading an AI analysis, as rules rather than as a screen.
 *
 * Import-free so it can be tested directly, which matters here more than the
 * shape of the code suggests. Everything in an `ai_analyses` row is written by
 * a language model, which means every field is optional in practice regardless
 * of what the column says: a run can complete with no defects, no
 * recommendations, an empty report and a severity string nobody has seen
 * before. A screen that assumes otherwise crashes on the one photo of a clean
 * wall.
 */

export type AnalysisStatus = "processing" | "completed" | "failed" | string;

export type Defect = {
  description?: string | null;
  severity?: string | null;
  location?: string | null;
};

export type PhotoAnalysis = {
  id: string;
  photo_id: string;
  status: AnalysisStatus;
  ocr_text: string | null;
  labels: string[] | null;
  defects: Defect[] | null;
  report_text: string | null;
  recommendations: string[] | null;
  created_at: string;
};

/**
 * Severity, normalised.
 *
 * The model is asked for a severity and returns whatever word it likes:
 * "High", "critical", "MEDIUM", sometimes a sentence. Mapping to three buckets
 * is what lets the list sort and colour consistently, and an unrecognised value
 * has to land somewhere rather than sorting to the top by accident.
 */
export type Severity = "high" | "medium" | "low";

export function severityOf(defect: Defect): Severity {
  const raw = (defect.severity ?? "").trim().toLowerCase();
  if (/(critical|severe|high|urgent|danger)/.test(raw)) return "high";
  if (/(moderate|medium|fair)/.test(raw)) return "medium";
  if (/(minor|low|cosmetic|slight)/.test(raw)) return "low";
  /*
   * Unknown reads as medium, not high.
   *
   * High is the colour that makes somebody stop work, so it has to mean the
   * model actually said so. Defaulting an unparsed word to high would turn
   * every quirk of phrasing into a red flag, and a red flag that is usually
   * wrong is ignored within a week.
   */
  return "medium";
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Worst first.
 *
 * A phone shows three defects before the fold. If they are in the model's
 * order, the one that matters is as likely to be fourth as first.
 */
export function sortDefects(defects: Defect[]): Defect[] {
  return [...defects].sort((a, b) => SEVERITY_RANK[severityOf(a)] - SEVERITY_RANK[severityOf(b)]);
}

/** The badge word next to a defect. */
export function severityLabel(severity: Severity): string {
  return severity === "high" ? "High" : severity === "medium" ? "Medium" : "Low";
}

/**
 * The defects worth rendering.
 *
 * A defect with no description is a row that says "Medium" and nothing else,
 * which is worse than one fewer row: the reader cannot tell whether it is a
 * finding or a rendering bug.
 */
export function usableDefects(analysis: Pick<PhotoAnalysis, "defects">): Defect[] {
  const list = Array.isArray(analysis.defects) ? analysis.defects : [];
  return sortDefects(list.filter((d) => (d?.description ?? "").trim().length > 0));
}

/** Recommendations, with the blanks dropped. */
export function usableRecommendations(analysis: Pick<PhotoAnalysis, "recommendations">): string[] {
  const list = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
  return list.map((r) => (r ?? "").trim()).filter((r) => r.length > 0);
}

/** Labels, deduplicated case-insensitively and with the blanks dropped. */
export function usableLabels(analysis: Pick<PhotoAnalysis, "labels">): string[] {
  const list = Array.isArray(analysis.labels) ? analysis.labels : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const value = (raw ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    // The model repeats itself: "panel" and "Panel" come back from the same
    // run often enough that a chip row of six shows four distinct words.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * The transcribed text, or null.
 *
 * Preserved line for line rather than collapsed to a paragraph. The brand,
 * model and serial the service folds in are one per line, and running them
 * together turns a serial number into part of a sentence.
 */
export function usableOcr(analysis: Pick<PhotoAnalysis, "ocr_text">): string | null {
  const lines = (analysis.ocr_text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length ? lines.join("\n") : null;
}

/**
 * Whether a completed analysis actually said anything.
 *
 * A run can complete with every field empty, which is the correct answer for a
 * photo of a clean wall. Rendering that as an analysis screen full of empty
 * headings reads as broken; saying "nothing found" reads as an answer.
 */
export function isAnalysisEmpty(analysis: PhotoAnalysis): boolean {
  return (
    !analysis.report_text?.trim() &&
    usableDefects(analysis).length === 0 &&
    usableRecommendations(analysis).length === 0 &&
    usableLabels(analysis).length === 0 &&
    !usableOcr(analysis)
  );
}

/** The one-line state for a photo, used on the button that opens this. */
export function analysisSummary(analysis: PhotoAnalysis | null): string {
  if (!analysis) return "Not analysed yet";
  if (analysis.status === "processing") return "Analysing";
  if (analysis.status === "failed") return "Analysis failed";
  if (isAnalysisEmpty(analysis)) return "Nothing found";

  const defects = usableDefects(analysis);
  if (defects.length === 0) return "No defects found";

  const high = defects.filter((d) => severityOf(d) === "high").length;
  // The high count leads when there is one, because it is the only number on
  // this screen anybody acts on immediately.
  if (high > 0) return `${high} high severity of ${defects.length}`;
  return `${defects.length} finding${defects.length === 1 ? "" : "s"}`;
}
