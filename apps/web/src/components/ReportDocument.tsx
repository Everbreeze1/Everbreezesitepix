// Visual report document - rendered identically in:
//   - the in-builder Preview tab
//   - the public shareable view
// And visually mirrors the PDF generator (cover page + section pages,
// photos-per-page grid, captions beside / below depending on density).
import { FileText, ImageOff, MapPin, Calendar } from "lucide-react";
import { RichText } from "@/components/RichText";
import { richIsEmpty, planSectionPages, type RichBlock } from "@everlumen/shared";
import { cn } from "@/lib/utils";

export interface ReportDocCompany {
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
}
export interface ReportDocProject {
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}
export interface ReportDocPhoto {
  photo_id: string;
  image_url: string;
  caption: string; // plain or HTML
}
export interface ReportDocSection {
  id: string;
  title: string; // plain or HTML
  body: string | null; // plain or HTML
  photos: ReportDocPhoto[];
}
export interface ReportDocModel {
  title: string;
  summary: string | null; // plain or HTML - no longer shown on cover, kept for compat
  subtitle: string | null; // optional plain-text subtitle shown under the title on the cover
  createdAt: string;
  photosPerPage: 1 | 2 | 3 | 4;
  cover: {
    enabled: boolean;
    showProjectName: boolean;
    showAddress: boolean;
    showDate: boolean;
    showAuthor: boolean;
    photos: ReportDocPhoto[];
  };
  project: ReportDocProject | null;
  company: ReportDocCompany | null;
  authorName: string | null;
  sections: ReportDocSection[];
}

function addressOf(p: ReportDocProject | null): string {
  if (!p) return "";
  return [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip]
    .filter(Boolean)
    .join(" · ");
}

/**
 * `authoring` is who is looking, not what is rendered.
 *
 * The same component draws the builder's preview and the page a customer opens
 * from a share link, which is how "Switch to Edit to add one" ended up on an
 * empty report sent to a client - an instruction for a control they cannot see,
 * on a document that is not theirs to write. The builder passes the flag; the
 * public route does not, and gets a line that simply states the fact.
 */
export function ReportDocument({
  doc,
  authoring = false,
}: {
  doc: ReportDocModel;
  authoring?: boolean;
}) {
  const addr = addressOf(doc.project);
  const totalPhotos = countPhotos(doc);
  return (
    <div className="report-doc space-y-6">
      {/* COVER PAGE */}
      {doc.cover.enabled && (
        <ReportPage>
          <CompanyHeader company={doc.company} />
          <div className="my-8 h-px w-full bg-neutral-200" />

          {/* Centered hero block */}
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
              Project Report
            </div>
            <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-neutral-900 sm:text-4xl">
              {doc.title || "Untitled report"}
            </h1>

            {doc.subtitle && doc.subtitle.trim() && (
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-neutral-600">
                {doc.subtitle}
              </p>
            )}

            {/* Meta stats row */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-neutral-800">
              {doc.cover.showAuthor && doc.authorName && (
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Prepared by
                  </span>
                  <span className="mt-1 font-semibold text-neutral-900">{doc.authorName}</span>
                </div>
              )}
              {doc.cover.showDate && (
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Date
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1.5 font-semibold text-neutral-900">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(doc.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  Photos
                </span>
                <span className="mt-1 font-semibold text-neutral-900">{totalPhotos} included</span>
              </div>
            </div>
          </div>

          {doc.cover.showProjectName && doc.project && (
            <div className="mx-auto mt-10 max-w-xl rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                Project
              </div>
              <div className="mt-1.5 text-lg font-semibold text-neutral-900">
                {doc.project.name}
              </div>
              {doc.cover.showAddress && addr && (
                <div className="mt-1.5 flex items-center justify-center gap-1.5 text-sm text-neutral-700">
                  <MapPin className="h-3.5 w-3.5" />
                  {addr}
                </div>
              )}
            </div>
          )}

          {doc.cover.photos.length > 0 && (
            <div
              className={cn(
                "mt-10 grid gap-3",
                doc.cover.photos.length === 1
                  ? "grid-cols-1"
                  : doc.cover.photos.length === 2
                    ? "grid-cols-2"
                    : "grid-cols-2 sm:grid-cols-3",
              )}
            >
              {doc.cover.photos.map((p) => (
                <CoverPhoto key={p.photo_id} photo={p} />
              ))}
            </div>
          )}

          <PageFooter company={doc.company?.name ?? null} />
        </ReportPage>
      )}

      {/*
        SECTION PAGES

        Built from `planSectionPages`, the same function public-pdf.ts uses, so
        the preview and the downloaded file break in the same places. This used
        to be one page per section with no way to split a long one, which is
        what "I should be able to insert a page break" was about.
      */}
      {doc.sections.length === 0 ? (
        <ReportPage>
          <CompanyHeader company={doc.company} small />
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {authoring
              ? "No sections yet. Switch to Edit to add one."
              : "This report has no sections yet."}
          </div>
        </ReportPage>
      ) : (
        doc.sections.flatMap((sec, idx) =>
          planSectionPages<ReportDocPhoto>({
            body: sec.body,
            photos: sec.photos,
            photosPerPage: doc.photosPerPage,
          }).map((plan, pageIdx) => (
            <SectionPage
              key={`${sec.id}:${pageIdx}`}
              section={sec}
              blocks={plan.blocks}
              photos={plan.photos}
              // Only the first page of a section repeats its title; a heading
              // stamped on every continuation reads as a new section each time.
              showTitle={pageIdx === 0}
              index={idx}
              total={doc.sections.length}
              reportTitle={doc.title}
              company={doc.company}
              photosPerPage={doc.photosPerPage}
            />
          )),
        )
      )}
    </div>
  );
}

function ReportPage({ children }: { children: React.ReactNode }) {
  // Mimic US Letter aspect (8.5 / 11). Width fluid, height proportional, with
  // print-page styling: white surface, soft shadow, generous padding.
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[820px]",
        "rounded-md border border-border bg-white text-neutral-900",
        "shadow-[0_1px_3px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.18)]",
        "px-10 py-12 print:shadow-none print:border-0 print:p-0",
      )}
    >
      {children}
    </div>
  );
}

function CompanyHeader({
  company,
  small = false,
}: {
  company: ReportDocCompany | null;
  small?: boolean;
}) {
  const name = company?.name || "Everlumen";
  return (
    <div className="flex items-start gap-3">
      {company?.logo_url ? (
        <img
          src={company.logo_url}
          alt={name}
          className={cn("rounded object-contain", small ? "h-8 w-8" : "h-12 w-12")}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded bg-primary/10 text-primary",
            small ? "h-8 w-8" : "h-12 w-12",
          )}
        >
          <FileText className={small ? "h-4 w-4" : "h-6 w-6"} />
        </div>
      )}
      <div className="min-w-0">
        <div
          className={cn(
            "font-semibold leading-tight text-neutral-900",
            small ? "text-sm" : "text-base",
          )}
        >
          {name}
        </div>
        {company?.phone && <div className="text-xs text-neutral-700">{company.phone}</div>}
        {company?.address && <div className="text-xs text-neutral-700">{company.address}</div>}
      </div>
    </div>
  );
}

function PageFooter({ company }: { company: string | null }) {
  return (
    <div className="mt-12 border-t border-neutral-200 pt-3 text-[10px] text-neutral-600">
      Generated with Everlumen{company ? ` · ${company}` : ""}
    </div>
  );
}

function CoverPhoto({ photo }: { photo: ReportDocPhoto }) {
  return (
    <figure className="overflow-hidden rounded-md border border-neutral-200">
      <div className="aspect-[4/3] bg-neutral-100">
        {photo.image_url ? (
          <img src={photo.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-400">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
      </div>
      {!richIsEmpty(photo.caption) && (
        <figcaption className="px-3 py-2 text-xs text-neutral-800">
          <RichText html={photo.caption} size="sm" />
        </figcaption>
      )}
    </figure>
  );
}

function countPhotos(doc: ReportDocModel): number {
  const ids = new Set<string>();
  doc.sections.forEach((s) => s.photos.forEach((p) => p.photo_id && ids.add(p.photo_id)));
  doc.cover.photos.forEach((p) => p.photo_id && ids.add(p.photo_id));
  return ids.size;
}

function SectionPage({
  section,
  blocks,
  photos,
  showTitle,
  index,
  total,
  reportTitle,
  company,
  photosPerPage,
}: {
  section: ReportDocSection;
  /** This page's slice of the body, already split on page breaks. */
  blocks: RichBlock[];
  /** This page's slice of the section's photos. */
  photos: ReportDocPhoto[];
  showTitle: boolean;
  index: number;
  total: number;
  reportTitle: string;
  company: ReportDocCompany | null;
  photosPerPage: 1 | 2 | 3 | 4;
}) {
  return (
    <ReportPage>
      <div className="mb-4 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
        <span className="truncate">{reportTitle || "Report"}</span>
        <span>
          Section {index + 1} of {total}
        </span>
      </div>
      <div className="mb-6 h-px w-full bg-neutral-200" />

      {showTitle && section.title && (
        <div className="mb-5">
          {section.title.startsWith("<") ? (
            <RichText html={section.title} />
          ) : (
            <h2 className="text-3xl font-extrabold tracking-tight text-neutral-900">
              {section.title}
            </h2>
          )}
        </div>
      )}
      {blocks.length > 0 && (
        <div className="mb-7 text-neutral-800">
          {/* Pre-split blocks, not the raw body - this page holds one group. */}
          <RichText blocks={blocks} />
        </div>
      )}

      {photos.length > 0 && <PhotoGrid photos={photos} perPage={photosPerPage} />}

      <PageFooter company={company?.name ?? null} />
    </ReportPage>
  );
}

function PhotoGrid({ photos, perPage }: { photos: ReportDocPhoto[]; perPage: 1 | 2 | 3 | 4 }) {
  // Always render photo-left, caption-right (side-by-side). `perPage` only
  // controls visual rhythm (page break gap) - every photo gets a full-width
  // side-by-side row so captions are clean, bold, and easy to read.
  const pages: ReportDocPhoto[][] = [];
  for (let i = 0; i < photos.length; i += perPage) pages.push(photos.slice(i, i + perPage));

  return (
    <div className="space-y-6">
      {pages.map((batch, pi) => (
        <div key={pi}>
          <div className="grid grid-cols-1 gap-4">
            {batch.map((p) => (
              <figure
                key={p.photo_id}
                className="grid grid-cols-[3fr_2fr] overflow-hidden rounded-lg border border-neutral-200 shadow-sm"
              >
                <PhotoFrame photo={p} ratio="4/3" />
                <figcaption className="flex items-center border-l border-neutral-200 bg-neutral-50 p-5 text-[15px] font-semibold leading-relaxed text-neutral-900">
                  {richIsEmpty(p.caption) ? (
                    <span className="italic font-normal text-neutral-400">No caption</span>
                  ) : (
                    <RichText html={p.caption} />
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
          {pi < pages.length - 1 && <div className="mt-6 h-px w-full bg-neutral-100" />}
        </div>
      ))}
    </div>
  );
}

function PhotoFrame({ photo, ratio }: { photo: ReportDocPhoto; ratio: "4/3" | "16/9" }) {
  const cls = ratio === "16/9" ? "aspect-[16/9]" : "aspect-[4/3]";
  return (
    <div className={cn(cls, "bg-neutral-100")}>
      {photo.image_url ? (
        <img src={photo.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-neutral-400">
          <ImageOff className="h-6 w-6" />
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
