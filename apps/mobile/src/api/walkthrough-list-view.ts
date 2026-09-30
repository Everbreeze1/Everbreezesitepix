/**
 * Reading a walkthrough as the two things it is.
 *
 * Jon, testing the Android build, pointed out that a walkthrough has two parts
 * (the AI Summary written from what was said, and the video itself) and that
 * the Walkthroughs tab did not make that apparent.
 *
 * The recording and its AI Summary live in different tables, and the tab used
 * to list them in two unrelated sections. These helpers pair them back up so a
 * card can say, for one walk, both "here is the video" and "here is what it was
 * written up as, and whether that is ready yet".
 *
 * Import-free so the pairing and the wording can be tested directly.
 */

/** The parts of a summary these judgements need. */
export type PairableSummary = {
  id: string;
  walkthroughId: string | null;
  status: string;
  markdown: string | null;
  createdAt: string;
};

/** Where the AI Summary of one recording stands. */
export type AiSummaryStatus = "ready" | "generating" | "failed" | "none";

/**
 * The summary to show for each recording, keyed by walkthrough id.
 *
 * A recording can have more than one: "Regenerate" writes a new summary rather
 * than overwriting the old one, so the edits in the first are never lost. The
 * newest is the one somebody meant to produce, so it wins.
 */
export function summariesByWalkthrough<T extends PairableSummary>(summaries: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const summary of summaries) {
    if (!summary.walkthroughId) continue;
    const held = out.get(summary.walkthroughId);
    if (!held || Date.parse(summary.createdAt) > Date.parse(held.createdAt)) {
      out.set(summary.walkthroughId, summary);
    }
  }
  return out;
}

/** Summaries written from photographs alone, with no recording behind them. */
export function photoOnlySummaries<T extends PairableSummary>(summaries: T[]): T[] {
  return summaries.filter((summary) => !summary.walkthroughId);
}

/**
 * Where the AI Summary stands for one recording.
 *
 * "Generating" covers two different waits that look the same from the field:
 * the recording is still being transcribed and written up (the walkthrough row
 * says `generating` or `recording`), or the summary row exists and its body has
 * not arrived yet. Either way the answer is "not yet, it is coming".
 */
export function aiSummaryStatus(
  walkthrough: { status: string | null },
  summary: { status: string; markdown: string | null } | null | undefined,
): AiSummaryStatus {
  if (summary) {
    const status = (summary.status ?? "").toLowerCase();
    if (summary.markdown?.trim()) return "ready";
    if (status === "failed" || status === "error") return "failed";
    if (status === "pending" || status === "generating" || status === "processing") {
      return "generating";
    }
    // A finished row with an empty body was cleared by hand. It still exists.
    return "ready";
  }
  const walk = (walkthrough.status ?? "").toLowerCase();
  if (walk === "generating" || walk === "processing" || walk === "recording") return "generating";
  if (walk === "failed") return "failed";
  return "none";
}

/** The word on the status badge. */
export function aiSummaryLabel(status: AiSummaryStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "generating":
      return "Generating";
    case "failed":
      return "Failed";
    default:
      return "Not generated";
  }
}

/** Badge tone for each state, so only "ready" reads as done. */
export function aiSummaryTone(
  status: AiSummaryStatus,
): "success" | "primary" | "danger" | "neutral" {
  if (status === "ready") return "success";
  if (status === "generating") return "primary";
  if (status === "failed") return "danger";
  return "neutral";
}

/**
 * The first sentence-worth of the write-up, for the card.
 *
 * Headings are skipped rather than shown: "Overview" tells nobody which job
 * this was. The first line of prose under it does.
 */
export function summaryFirstLine(markdown: string | null, max = 140): string {
  if (!markdown) return "";
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--") || line.startsWith("![")) {
      continue;
    }
    const text = line
      .replace(/^[-*+]\s+/, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  }
  return "";
}

/** `4:05`, or empty for a recording with no length on it. */
export function clockDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 1) return "";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Who recorded it, in words.
 *
 * "You" for the person holding the phone, the teammate's name otherwise, and
 * null when neither can be told: a card that says nothing about who recorded
 * it is better than one that says a uuid.
 */
export function recordedBy(
  createdBy: string | null | undefined,
  selfId: string | null | undefined,
  names: Map<string, string>,
): string | null {
  if (!createdBy) return null;
  if (selfId && createdBy === selfId) return "You";
  return names.get(createdBy) ?? null;
}

/** One headed section of a write-up. */
export type SummarySection = { heading: string | null; body: string };

/**
 * Split a write-up at its `##` headings.
 *
 * The model writes "## Overview" and "## Findings", and the phone has no
 * markdown renderer. Showing them as labelled blocks is what makes the report
 * read like a report instead of one long paragraph. The top `#` title is
 * dropped: it repeats the walkthrough's own name, already on the screen.
 * Bodies are returned raw; the caller strips them with `plainBody`.
 */
export function summarySections(markdown: string | null): SummarySection[] {
  if (!markdown?.trim()) return [];
  const sections: SummarySection[] = [];
  let current: SummarySection = { heading: null, body: "" };
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,3}\s+(.*)$/.exec(line.trim());
    if (heading) {
      if (current.heading || current.body.trim()) sections.push(current);
      current = { heading: heading[1].trim(), body: "" };
      continue;
    }
    if (/^#\s+/.test(line.trim())) continue;
    current.body += `${line}\n`;
  }
  if (current.heading || current.body.trim()) sections.push(current);
  return sections
    .map((section) => ({ heading: section.heading, body: section.body.trim() }))
    .filter((section) => section.body || section.heading);
}

/**
 * What Delete says before it deletes. Plain about what survives, as the web's
 * confirm is: "cannot be undone" on its own reads as though the photos and the
 * write-up go with the recording.
 */
export const WALKTHROUGH_DELETE_WARNING =
  "Delete this walkthrough recording? Its summary and your photos are not affected. This cannot be undone.";

/**
 * The walkthrough edit form's patch, or why it cannot be saved.
 *
 * A title is required (the list and the share page both lead with it); notes
 * may be emptied, which stores null rather than an empty string so the
 * "Earlier report" block disappears instead of showing a blank card.
 */
export function walkthroughEditPatch(
  title: string,
  notes: string,
):
  | { ok: true; patch: { title: string; summary_markdown: string | null } }
  | { ok: false; error: string } {
  const cleanTitle = title.trim();
  if (!cleanTitle) return { ok: false, error: "Give the walkthrough a title." };
  if (cleanTitle.length > 200) return { ok: false, error: "Keep the title under 200 characters." };
  const cleanNotes = notes.trim();
  return { ok: true, patch: { title: cleanTitle, summary_markdown: cleanNotes ? notes : null } };
}
