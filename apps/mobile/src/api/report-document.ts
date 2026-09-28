import {
  planSectionPages,
  richIsEmpty,
  richToPlainText,
  type RichBlock,
} from "@everlumen/shared";

/**
 * A hand-built report as the client reads it, as data.
 *
 * The same model the web's `ReportDocument` draws for both the builder's
 * Preview tab and the public link: a cover page, then one page per section
 * (split with `planSectionPages`, the function the PDF uses, so a page here
 * breaks where the PDF breaks). The write-up and the loose photo list are not
 * on it because the client's page does not show them either; showing them here
 * would have the crew proofreading text their customer never sees.
 *
 * Import-light so it can be tested: only the shared rich-text helpers.
 */

export type ReportDocCompany = {
  name: string | null;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
};

export type ReportDocProject = {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type ReportDocPhoto = {
  photoId: string;
  /** Signed URL, or null while it signs or when the photo is gone. */
  uri: string | null;
  /** Plain text, markup removed. Empty when there is no caption. */
  caption: string;
};

export type ReportDocPage = {
  key: string;
  sectionIndex: number;
  /** Only the first page of a section repeats its heading, as on the web. */
  title: string | null;
  blocks: RichBlock[];
  photos: ReportDocPhoto[];
};

export type ReportDoc = {
  title: string;
  subtitle: string | null;
  cover: {
    enabled: boolean;
    authorName: string | null;
    dateLabel: string | null;
    projectName: string | null;
    address: string | null;
    photos: ReportDocPhoto[];
  };
  company: ReportDocCompany | null;
  photoCount: number;
  sectionCount: number;
  pages: ReportDocPage[];
};

export type ReportDocInput = {
  report: {
    title: string;
    subtitle: string | null;
    created_at: string;
    photos_per_page: number;
    cover_enabled: boolean;
    cover_show_project_name: boolean;
    cover_show_address: boolean;
    cover_show_date: boolean;
    cover_show_author: boolean;
    cover_photo_ids: string[];
  };
  sections: ReadonlyArray<{
    id: string;
    title: string;
    body: string | null;
    photos: ReadonlyArray<{ photo_id: string; caption: string }>;
  }>;
  urls: Record<string, string | undefined>;
  project: ReportDocProject | null;
  company: ReportDocCompany | null;
  authorName: string | null;
};

/** "12 Main St · Rocklin, CA · 95765", as the web cover prints it. */
export function reportAddress(project: ReportDocProject | null): string {
  if (!project) return "";
  return [project.street, [project.city, project.state].filter(Boolean).join(", "), project.zip]
    .filter(Boolean)
    .join(" · ");
}

/** "September 17, 2026", or null for a date that does not parse. */
export function reportDateLabel(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** A section heading or caption that may be HTML, as one plain line. */
export function plainLine(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  return text.startsWith("<") ? richToPlainText(text) : text;
}

export function buildReportDocument(input: ReportDocInput): ReportDoc {
  const { report } = input;
  const photo = (photoId: string, caption: string): ReportDocPhoto => ({
    photoId,
    uri: input.urls[photoId] ?? null,
    caption: richIsEmpty(caption) ? "" : plainLine(caption),
  });

  // Photos counted once each, cover and sections together, as the web counts.
  const ids = new Set<string>();
  for (const section of input.sections) for (const p of section.photos) ids.add(p.photo_id);
  for (const id of report.cover_photo_ids) ids.add(id);

  const perPage = Math.min(4, Math.max(1, Math.round(report.photos_per_page) || 2)) as
    | 1
    | 2
    | 3
    | 4;

  const pages: ReportDocPage[] = input.sections.flatMap((section, sectionIndex) =>
    planSectionPages({
      body: section.body,
      photos: section.photos.map((p) => photo(p.photo_id, p.caption)),
      photosPerPage: perPage,
    }).map((plan, pageIndex) => ({
      key: `${section.id}:${pageIndex}`,
      sectionIndex,
      title: pageIndex === 0 ? plainLine(section.title) || null : null,
      blocks: plan.blocks.filter((block) => block.type !== "pageBreak"),
      photos: plan.photos,
    })),
  );

  const address = reportAddress(input.project);
  return {
    title: report.title.trim() || "Untitled report",
    subtitle: report.subtitle?.trim() || null,
    cover: {
      enabled: report.cover_enabled,
      authorName: report.cover_show_author ? input.authorName?.trim() || null : null,
      dateLabel: report.cover_show_date ? reportDateLabel(report.created_at) : null,
      projectName:
        report.cover_show_project_name && input.project ? input.project.name || null : null,
      address:
        report.cover_show_project_name && report.cover_show_address && address ? address : null,
      photos: report.cover_photo_ids.map((id) => photo(id, "")),
    },
    company: input.company,
    photoCount: ids.size,
    sectionCount: input.sections.length,
    pages,
  };
}
