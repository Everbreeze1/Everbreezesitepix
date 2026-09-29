import { groupByTrade, matchesSearch, nextCopyName } from "./template-library-view";

/**
 * The document template library: the web's `DocumentTemplatesManager`, for a
 * phone.
 *
 * Import-free so it is tested directly. The rules that matter:
 *
 * - `body` is jsonb holding `{ style, html, description, category, filesUnder,
 *   copiedFrom }` and keys this screen does not know about. Every write
 *   spreads the stored body rather than rebuilding it, so nothing is dropped.
 * - A built-in (no team) is shared by every company and RLS refuses writes to
 *   it, so editing one makes the company's own copy, marked `copiedFrom`, and
 *   the built-in steps aside behind it: one card per document either way.
 */

export type FilingBucket = "report" | "invoice" | "document";

export const FILING_OPTIONS: { id: FilingBucket; label: string; hint: string }[] = [
  { id: "report", label: "Reports", hint: "Lands in the project's Reports tab" },
  { id: "invoice", label: "Invoices", hint: "Lands in Documents, filed as an invoice" },
  { id: "document", label: "Documents", hint: "Lands in the project's Documents tab" },
];

/** A row as the list reads it: the small keys of `body`, never its HTML. */
export type DocTemplateRow = {
  id: string;
  teamId: string | null;
  name: string;
  description: string | null;
  category: string | null;
  filesUnder: FilingBucket;
  copiedFrom: string | null;
  fields: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export function isExample(row: Pick<DocTemplateRow, "teamId">): boolean {
  return row.teamId === null;
}

export function normaliseFiling(value: unknown): FilingBucket {
  return value === "invoice" || value === "document" ? value : "report";
}

/**
 * Built-ins the team has its own live version of. Only a live row shadows:
 * archive or delete the company's version and the example comes back, which is
 * also the undo for having made one.
 */
export function shadowedExamples(rows: readonly DocTemplateRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (row.teamId === null || row.archived) continue;
    if (row.copiedFrom) out.add(row.copiedFrom);
  }
  return out;
}

/** The list: archive filter, shadowing and search, grouped by trade. */
export function groupDocTemplates(
  rows: readonly DocTemplateRow[],
  opts: { showArchived: boolean; search: string },
): { trade: string; rows: DocTemplateRow[] }[] {
  const hidden = shadowedExamples(rows);
  const visible = rows.filter(
    (r) =>
      (opts.showArchived || !r.archived) &&
      !(r.teamId === null && hidden.has(r.id)) &&
      matchesSearch(opts.search, r.name, r.description, r.category),
  );
  const groups = groupByTrade(visible, (row) => row.category);
  // Within a trade, the team's own (editable) templates first, then built-ins.
  for (const group of groups) {
    group.rows.sort((a, b) => {
      if (isExample(a) !== isExample(b)) return isExample(a) ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }
  return groups;
}

/** The merge fields a body uses, as the web stores them in `fields`. */
export function extractFields(html: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) set.add(m[1].toLowerCase());
  return [...set].sort();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The first body of a new template.
 *
 * The web's wizard with its Minimal cover and its three starting sections, so
 * a template made on a phone opens on the web looking like one made there.
 * Plain headings and paragraphs only, so every block is editable here.
 */
export function newTemplateHtml(name: string, subtitle: string): string {
  const cover = `<h1>${escapeHtml(name.trim())}</h1>${
    subtitle.trim() ? `<p>${escapeHtml(subtitle.trim())}</p>` : ""
  }`;
  const sections = [
    ["Executive summary", "Overview of the work for {{project_name}} on {{report_date}}."],
    ["Observations", "Notes from the crew, plus supporting photos."],
    ["Photos", "All photos tagged to this visit, in a grid."],
  ]
    .map(([heading, body]) => `<h2>${heading}</h2><p>${body}</p>`)
    .join("");
  return cover + sections;
}

/**
 * A stored body with some keys replaced, every other key kept.
 * `category: null` removes the key: General is the absence of a trade.
 */
export function withBody(
  raw: unknown,
  patch: {
    html?: string;
    category?: string | null;
    filesUnder?: FilingBucket;
    copiedFrom?: string;
  },
): Record<string, unknown> {
  const out: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : { style: "report", html: "", description: "" };
  if (patch.html !== undefined) out.html = patch.html;
  if (patch.filesUnder !== undefined) out.filesUnder = patch.filesUnder;
  if (patch.copiedFrom !== undefined) out.copiedFrom = patch.copiedFrom;
  if (patch.category !== undefined) {
    if (patch.category) out.category = patch.category;
    else delete out.category;
  }
  return out;
}

/**
 * The name a copy takes. A copy of a built-in replaces it on the page, so it
 * keeps the built-in's name when that name is free; a copy of the team's own
 * template is a second template and is numbered.
 */
export function copyName(source: DocTemplateRow, taken: readonly string[]): string {
  const clash = taken.some((n) => n.trim().toLowerCase() === source.name.trim().toLowerCase());
  if (isExample(source) && !clash) return source.name;
  return nextCopyName(source.name, taken);
}
