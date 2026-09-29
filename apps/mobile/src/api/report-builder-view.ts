import { parsePage, serialiseBlocks, newBlockId, type Block } from "./doc-blocks";

/**
 * The report builder's rules, free of React and the network so they can be
 * tested.
 *
 * The web builder (`ReportBuilderPage`) edits a report as a cover page plus an
 * ordered list of sections, each with a body and captioned photos. The PDF and
 * the public page are rendered from those rows, so the phone has to write them
 * in exactly the shape the web does: positions that never collide, photo
 * arrays of `{ photo_id, caption }`, and section bodies as HTML.
 */

export type SectionPhoto = { photo_id: string; caption: string };

export type ReportSection = {
  id: string;
  report_id: string;
  position: number;
  title: string;
  body: string | null;
  photos: SectionPhoto[];
};

export type CoverOptions = {
  cover_enabled: boolean;
  cover_show_project_name: boolean;
  cover_show_address: boolean;
  cover_show_date: boolean;
  cover_show_author: boolean;
};

export type PhotosPerPage = 1 | 2 | 3 | 4;

/** The server accepts 1 to 4. Anything else is read as the default of 2. */
export function clampPhotosPerPage(value: unknown): PhotosPerPage {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(1, n)) as PhotosPerPage;
}

/** What the photos-per-page choice means on paper, in the web's own words. */
export function photosPerPageHint(value: PhotosPerPage): string {
  return value === 1
    ? "One photo per page, each with its own heading and space to write under it."
    : `${value} photos across, grouped under one "Photographic record" heading.`;
}

/** Whatever the jsonb column holds, as a clean photo list. */
export function normaliseSectionPhotos(raw: unknown): SectionPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: SectionPhoto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { photo_id?: unknown }).photo_id;
    if (typeof id !== "string" || !id) continue;
    const caption = (item as { caption?: unknown }).caption;
    out.push({ photo_id: id, caption: typeof caption === "string" ? caption : "" });
  }
  return out;
}

/** A string-array jsonb column (cover photos), whatever it holds. */
export function normaliseIdList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The position for a new section: one past the highest in use.
 *
 * Not `sections.length`. Deleting a section leaves a gap and never renumbers,
 * so counting survivors would reuse a position somebody still holds and the
 * two would sort arbitrarily in the builder and in the exported PDF.
 */
export function nextSectionPosition(sections: ReadonlyArray<{ position: number }>): number {
  return sections.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}

/** Move one item; out of range returns the same array so an end arrow is inert. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list as T[];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Renumber from zero, which is what the web writes after every reorder. */
export function renumberSections<T extends { position: number }>(list: readonly T[]): T[] {
  return list.map((section, index) => ({ ...section, position: index }));
}

/** Add photos to a list, skipping ones already there and keeping existing captions. */
export function addPhotos(existing: SectionPhoto[], ids: readonly string[]): SectionPhoto[] {
  const have = new Set(existing.map((p) => p.photo_id));
  const added = ids.filter((id) => !have.has(id)).map((id) => ({ photo_id: id, caption: "" }));
  return [...existing, ...added];
}

export function removePhoto(existing: SectionPhoto[], photoId: string): SectionPhoto[] {
  return existing.filter((p) => p.photo_id !== photoId);
}

export function setPhotoCaption(
  existing: SectionPhoto[],
  photoId: string,
  caption: string,
): SectionPhoto[] {
  return existing.map((p) => (p.photo_id === photoId ? { ...p, caption } : p));
}

/* --------------------------------------------------- section body text ---- */

/**
 * A section body as text the phone can edit, or a refusal.
 *
 * Bodies are HTML written by the web's rich text editor. The phone edits them
 * as plain lines: `## ` starts a heading, `- ` a bullet, anything else is a
 * paragraph. It only offers to edit when that round trip is exact, which is
 * the same promise `doc-blocks` makes for pages: a body with a table, a link or
 * bold text is shown read-only rather than flattened on save.
 */
export type EditableBody = { editable: true; text: string } | { editable: false; preview: string };

const HEADING_MARK = "## ";
const BULLET_MARK = "- ";

export function sectionBodyToText(html: string | null): EditableBody {
  const source = (html ?? "").trim();
  if (!source || source === "<p></p>") return { editable: true, text: "" };
  const parsed = parsePage(source);
  if (parsed.refusal) return { editable: false, preview: plainPreview(source) };
  const lines: string[] = [];
  for (const block of parsed.blocks) {
    // A paragraph that already starts with a marker would come back as a
    // different kind of block, so it is not something this can rebuild.
    if (
      block.kind === "paragraph" &&
      (block.text.startsWith(HEADING_MARK) || block.text.startsWith(BULLET_MARK))
    ) {
      return { editable: false, preview: plainPreview(source) };
    }
    if (block.text.includes("\n")) return { editable: false, preview: plainPreview(source) };
    if (block.kind === "heading") lines.push(`${HEADING_MARK}${block.text}`);
    else if (block.kind === "bullet") lines.push(`${BULLET_MARK}${block.text}`);
    else lines.push(block.text);
  }
  return { editable: true, text: lines.join("\n") };
}

/** The inverse: one block per non-empty line. */
export function textToSectionBody(text: string): string {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(HEADING_MARK)) {
      blocks.push({ id: newBlockId(), kind: "heading", text: line.slice(HEADING_MARK.length) });
    } else if (line.startsWith(BULLET_MARK)) {
      blocks.push({ id: newBlockId(), kind: "bullet", text: line.slice(BULLET_MARK.length) });
    } else {
      blocks.push({ id: newBlockId(), kind: "paragraph", text: line });
    }
  }
  return serialiseBlocks(blocks);
}

function plainPreview(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* -------------------------------------------------------- plan gating ---- */

/**
 * Whether templates are locked for this workspace, as the web's
 * `useTemplateGate` decides it: Pro and Team (or an internal team) get them,
 * Starter sees them with a padlock. Unknown (still loading, or the call
 * failed) is treated as unlocked, because the server is the enforcing
 * authority and locking a paying crew out on a slow network is the worse miss.
 */
export function templatesLockedFor(
  team: { plan?: string | null; isActive?: boolean; isInternal?: boolean } | null | undefined,
): boolean {
  if (!team) return false;
  if (team.isInternal) return false;
  const pro = team.plan === "pro" || team.plan === "team";
  return !(team.isActive && pro);
}

/* ------------------------------------------------- the generate menu ---- */

export type GenerateKind =
  | "summary"
  | "full_report"
  | "photo_report"
  | "built_report"
  | "template"
  | "blank_page";

export type GenerateOption = {
  kind: GenerateKind;
  group: string;
  title: string;
  description: string;
  /** Needs Pro or Team; shown with a padlock when locked. */
  pro: boolean;
};

/**
 * What the New report sheet offers, in the web menu's order and words.
 *
 * `scope` mirrors GenerateDocumentMenu: "reports" is the Reports tab's own
 * button and leaves out the paperwork kinds, "all" is everything.
 */
export function generateOptions(scope: "reports" | "all"): GenerateOption[] {
  const options: GenerateOption[] = [
    {
      kind: "summary",
      group: "Saved under Walkthroughs",
      title: "AI Summary",
      description: "Short shareable brief from photos you already have",
      pro: false,
    },
    {
      kind: "full_report",
      group: "Saved under Reports",
      title: "Full Project Report",
      description: "Every photo on the job, organised by label, with your client details",
      pro: false,
    },
    {
      kind: "photo_report",
      group: "Saved under Reports",
      title: "Report from selected photos",
      description: "Client-ready: title page, summary, photo sections, conclusion",
      pro: false,
    },
    {
      kind: "built_report",
      group: "Saved under Reports",
      title: "Build a report by hand",
      description: "Cover page and sections you fill in, from a blank page or a starter",
      pro: false,
    },
  ];
  if (scope === "all") {
    options.push(
      {
        kind: "template",
        group: "Saved under Documents",
        title: "More Templates",
        description: "Saved by your team or examples",
        pro: true,
      },
      {
        kind: "blank_page",
        group: "Saved under Documents",
        title: "Blank page",
        description: "Start from scratch",
        pro: false,
      },
    );
  }
  return options;
}

/** The server takes 1 to 50 photos for any AI document. */
export const MAX_GENERATE_PHOTOS = 50;

export function generatePhotoError(count: number): string | null {
  if (count < 1) return "Choose at least one photo.";
  if (count > MAX_GENERATE_PHOTOS) return `Choose ${MAX_GENERATE_PHOTOS} photos or fewer.`;
  return null;
}

/** Split a list in two for a tablet: wide enough for a list and an open report side by side. */
export const TWO_PANE_MIN_WIDTH = 768;

export function isTwoPane(width: number): boolean {
  return width >= TWO_PANE_MIN_WIDTH;
}
