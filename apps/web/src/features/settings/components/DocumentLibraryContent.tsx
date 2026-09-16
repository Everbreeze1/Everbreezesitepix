import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/everlumen/client";
import { parseReportTemplateStructure } from "@everlumen/shared";
import { GENERAL_CATEGORY, makeCategoryRank } from "@/lib/template-categories";
import { useCompanySetup } from "@/hooks/use-company-setup";

/*
 * The Documents page, laid out exactly as the Main-html reference
 * (public/Main-html/DocumentsContent.dc.html): a Document-template /
 * Report-template sub-tab strip, trade filter pills, a grid of template cards,
 * a reports rail with a detail pane, and a 3-step wizard with a live preview.
 *
 * Unlike the reference (a static mockup), the cards come from the account's
 * real document_templates and report_templates. Badge type, token count and
 * the preview excerpt are derived from each template's stored body; the wizard
 * is the reference's authoring UI, shown exactly as mocked.
 */

type SubTab = "documents" | "reports";
type BadgeType = "Report" | "Invoice" | "Site log" | "Document";
type CoverKind = "minimal" | "centered" | "hero" | "photo";

interface DocTemplate {
  id: string;
  name: string;
  archived: boolean;
  updated_at: string;
  style: string;
  category: string | null;
  tokens: number;
  excerpt: string;
}

interface ReportTemplate {
  id: string;
  name: string;
  archived: boolean;
  updated_at: string;
  sectionCount: number;
  sectionList: Array<{ heading: string; layout: string }>;
}

const BADGE_STYLES: Record<BadgeType, { bg: string; color: string }> = {
  Report: { bg: "oklch(93% 0.03 55)", color: "oklch(40% 0.11 55)" },
  Invoice: { bg: "oklch(90% 0.05 150)", color: "oklch(35% 0.1 150)" },
  "Site log": { bg: "oklch(93% 0.025 200)", color: "oklch(38% 0.1 200)" },
  Document: { bg: "oklch(90% 0.05 30)", color: "oklch(40% 0.13 30)" },
};

/** `document_templates.body` is `{ style, html, description, category, copiedFrom }`. */
function parseDocBody(body: unknown): {
  style: string;
  html: string;
  description: string;
  category: string | null;
} {
  if (!body || typeof body !== "object") return { style: "report", html: "", description: "", category: null };
  const b = body as Record<string, unknown>;
  return {
    style: typeof b.style === "string" ? b.style : "report",
    html: typeof b.html === "string" ? b.html : "",
    description: typeof b.description === "string" ? b.description : "",
    category: typeof b.category === "string" ? b.category : null,
  };
}

function badgeForStyle(style: string): BadgeType {
  if (style === "report") return "Report";
  if (style === "invoice") return "Invoice";
  if (style === "sitelog" || style === "sitelog_basic" || style === "daily_log") return "Site log";
  return "Document";
}

function countTokens(html: string): number {
  const m = html.match(/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/g);
  return m ? m.length : 0;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A short excerpt for the card, mirroring the mockup's preview line. */
function cardExcerpt(html: string, description: string): string {
  const text = htmlToText(html) || description;
  const plain = text.replace(/[{}]+/g, "").trim();
  if (plain.length <= 150) return plain;
  return `${plain.slice(0, 150).trim()}\u2026`;
}

const REPORT_LAYOUT_LABEL: Record<string, string> = {
  text: "Text only",
  "text-photos": "Text + photos",
  "photo-grid": "Photo grid",
  checklist: "Checklist recap",
};

const COVER_OPTIONS: Array<{ kind: CoverKind; label: string; desc: string }> = [
  { kind: "minimal", label: "Minimal", desc: "Clean title on a plain page." },
  { kind: "centered", label: "Centered", desc: "Large centered title with subtitle." },
  { kind: "hero", label: "Hero band", desc: "Bold colored hero band on top." },
  { kind: "photo", label: "Photo cover", desc: "Full-bleed cover photo with overlay." },
];

/* ---- Icons (paths from the mockup's inline SVGs) ---- */

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function XIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/* ---- Shared atoms ---- */

function Chip({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-[3px] text-[10.5px] text-muted-foreground">
      {children}
    </span>
  );
}

function Tok({ children }: { children: string }) {
  return (
    <span className="rounded-[4px] bg-[oklch(93%_0.025_200)] px-1.5 py-0.5 font-mono text-[10.5px] text-[oklch(38%_0.1_200)]">
      {children}
    </span>
  );
}

function TypeBadge({ type }: { type: BadgeType }) {
  const style = BADGE_STYLES[type];
  return (
    <span
      className="rounded-[6px] px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.03em]"
      style={{ background: style.bg, color: style.color }}
    >
      {type}
    </span>
  );
}

/* ---- Sub-tab strip: Document templates / Report templates ---- */

function SubTabStrip({
  value,
  docCount,
  reportCount,
  onChange,
}: {
  value: SubTab;
  docCount: number;
  reportCount: number;
  onChange: (t: SubTab) => void;
}) {
  const tabClass = (active: boolean) =>
    `cursor-pointer border-b-[2.5px] px-0.5 py-[9px] text-sm font-semibold transition-colors ${
      active
        ? "border-primary text-foreground"
        : "border-transparent text-faint hover:text-muted-foreground"
    }`;
  return (
    <div className="mb-[22px] flex gap-[22px] border-b border-border">
      <button onClick={() => onChange("documents")} className={tabClass(value === "documents")}>
        Document templates <span className="font-mono text-[11px] text-faint">{docCount}</span>
      </button>
      <button onClick={() => onChange("reports")} className={tabClass(value === "reports")}>
        Report templates <span className="font-mono text-[11px] text-faint">{reportCount}</span>
      </button>
    </div>
  );
}

/* ---- Document templates grid (the mockup's documents sub-tab), real data ---- */

function DocumentsGrid({
  docs,
  leadingCategory,
  onEdit,
  onCreate,
}: {
  docs: DocTemplate[];
  /** The company's top trade among those present, shown with a star. */
  leadingCategory: string | null;
  onEdit: () => void;
  onCreate: () => void;
}) {
  const [trade, setTrade] = useState<string>("all");

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) {
      const c = d.category || GENERAL_CATEGORY;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [docs]);

  return (
    <div>
      {/* Trade filter pills */}
      <div className="mb-[22px] flex flex-wrap gap-2">
        <button
          onClick={() => setTrade("all")}
          className={`cursor-pointer whitespace-nowrap rounded-full border px-[13px] py-1.5 text-xs font-semibold transition-colors ${
            trade === "all"
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
          }`}
        >
          All trades <span className="font-mono">{docs.length}</span>
        </button>
        {categories.map((c) => {
          const lead = leadingCategory === c.name;
          return (
            <button
              key={c.name}
              onClick={() => setTrade(c.name)}
              className={`cursor-pointer whitespace-nowrap rounded-full border px-[13px] py-1.5 text-xs font-semibold transition-colors ${
                trade === c.name
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {c.name}
              {lead ? " \u2605" : ""} <span className="font-mono">{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {docs.filter((d) => trade === "all" || d.category === trade || (!d.category && trade === GENERAL_CATEGORY)).map((doc) => (
          <div
            key={doc.id}
            onClick={onEdit}
            className="flex cursor-pointer flex-col gap-[11px] rounded-[13px] border border-border bg-card p-[18px] transition-colors hover:border-primary"
          >
            <div className="flex items-center justify-between">
              <TypeBadge type={badgeForStyle(doc.style)} />
              <span className="font-mono text-[11px] text-faint">{doc.tokens} tokens</span>
            </div>
            <div className="text-[14.5px] font-semibold text-foreground">{doc.name}</div>
            {doc.excerpt && (
              <div className="text-xs leading-[1.5] text-faint">{doc.excerpt}</div>
            )}
            <div className="flex flex-wrap items-center gap-[6px] border-t border-border pt-[11px]">
              <Chip>{doc.category || GENERAL_CATEGORY}</Chip>
            </div>
          </div>
        ))}

        {/* Dashed "Build a new template" card */}
        <div
          onClick={onCreate}
          className="flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-[13px] border border-dashed border-border bg-card p-[18px] text-faint transition-colors hover:border-primary"
        >
          <PlusIcon size={22} />
          <div className="mt-2 text-[13px] font-medium">Build a new template</div>
        </div>
      </div>
    </div>
  );
}

/* ---- Report templates (the mockup's reports sub-tab), real data ---- */

function ReportsView({
  reports,
  onEdit,
  onCreate,
}: {
  reports: ReportTemplate[];
  onEdit: () => void;
  onCreate: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(reports[0]?.id ?? null);
  const selected = reports.find((r) => r.id === selectedId) ?? reports[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
      {/* Report template rail */}
      <div className="flex flex-col gap-2">
        {reports.length === 0 && (
          <div className="rounded-[13px] border border-border bg-card p-3.5 text-[12.5px] text-faint">
            No report templates yet.
          </div>
        )}
        {reports.map((report) => {
          const active = selected?.id === report.id;
          return (
            <div
              key={report.id}
              onClick={() => setSelectedId(report.id)}
              className={`cursor-pointer rounded-[13px] border p-3.5 transition-colors ${
                active
                  ? "border-primary bg-[oklch(93%_0.03_55)]"
                  : "border-border bg-card hover:border-primary"
              }`}
            >
              <div className="text-[13.5px] font-semibold text-foreground">{report.name}</div>
              <div className="mt-0.5 text-[11.5px] text-faint">
                {report.sectionCount} {report.sectionCount === 1 ? "section" : "sections"}
              </div>
            </div>
          );
        })}

        {/* Dashed "+ New report template" card */}
        <div
          onClick={onCreate}
          className="flex cursor-pointer flex-col items-center justify-center rounded-[13px] border border-dashed border-border bg-card p-3.5 text-faint transition-colors hover:border-primary"
        >
          <div className="text-[12.5px]">+ New report template</div>
        </div>
      </div>

      {/* Selected report detail */}
      <div className="rounded-[13px] border border-border bg-card p-[26px]">
        {selected ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[17px] font-bold text-foreground">{selected.name}</div>
                <div className="mt-0.5 text-[12.5px] text-faint">
                  {selected.sectionCount} {selected.sectionCount === 1 ? "section" : "sections"}
                </div>
              </div>
              <button
                onClick={onEdit}
                className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
              >
                Edit template
              </button>
            </div>
            <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-faint">
              Sections
            </div>
            <div className="flex flex-col gap-2">
              {selected.sectionList.length > 0 ? (
                selected.sectionList.map((section) => (
                  <div
                    key={section.heading}
                    className="flex items-center justify-between rounded-lg bg-muted px-3 py-[9px] text-[13px] text-foreground"
                  >
                    <span>{section.heading}</span>
                    <Chip>{REPORT_LAYOUT_LABEL[section.layout] ?? "Section"}</Chip>
                  </div>
                ))
              ) : (
                <div className="rounded-lg bg-muted px-3 py-[9px] text-[13px] text-faint">
                  No sections yet.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="py-14 text-center text-[13px] text-faint">
            Select a report template to see its sections.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- 3-step wizard (the mockup's <sc-if isEditor> block) ---- */

function CoverSwatch({ kind }: { kind: CoverKind }) {
  if (kind === "minimal") {
    return (
      <div className="mb-2 flex h-11 items-center justify-center rounded-[6px] bg-muted">
        <div className="h-[5px] w-3/5 rounded-full bg-faint" />
      </div>
    );
  }
  if (kind === "centered") {
    return (
      <div className="mb-2 flex h-11 flex-col items-center justify-center gap-1 rounded-[6px] bg-muted">
        <div className="h-1.5 w-1/2 rounded-full bg-faint" />
        <div className="h-1 w-[30%] rounded-full bg-faint opacity-50" />
      </div>
    );
  }
  if (kind === "hero") {
    return (
      <div className="mb-2 flex h-11 items-center rounded-[6px] bg-[oklch(93%_0.03_55)] px-2">
        <div className="h-[5px] w-1/2 rounded-full bg-primary" />
      </div>
    );
  }
  return (
    <div
      className="mb-2 h-11 rounded-[6px]"
      style={{ background: "linear-gradient(160deg, oklch(45% 0.03 75), oklch(25% 0.02 75))" }}
    />
  );
}

function PreviewCover({ cover, title, subtitle }: { cover: CoverKind; title: string; subtitle: string }) {
  if (cover === "minimal") {
    return (
      <div className="px-[26px] py-[34px]">
        <div className="text-[17px] font-bold text-foreground">{title || "Untitled template"}</div>
        <div className="mt-1 text-xs text-faint">{subtitle}</div>
      </div>
    );
  }
  if (cover === "centered") {
    return (
      <div className="px-[26px] py-11 text-center">
        <div className="text-[19px] font-bold text-foreground">{title || "Untitled template"}</div>
        <div className="mt-1.5 text-xs text-faint">{subtitle}</div>
      </div>
    );
  }
  if (cover === "hero") {
    return (
      <div className="bg-primary px-[26px] py-[30px] text-primary-foreground">
        <div className="text-[18px] font-bold">{title || "Untitled template"}</div>
        <div className="mt-1 text-xs opacity-85">{subtitle}</div>
      </div>
    );
  }
  return (
    <div
      className="px-[26px] py-10 text-white"
      style={{ background: "linear-gradient(160deg, oklch(45% 0.03 75), oklch(25% 0.02 75))" }}
    >
      <div className="text-[18px] font-bold">{title || "Untitled template"}</div>
      <div className="mt-1 text-xs opacity-80">{subtitle}</div>
    </div>
  );
}

function BasicsStep({
  title,
  subtitle,
  setTitle,
  setSubtitle,
  cover,
  setCover,
}: {
  title: string;
  subtitle: string;
  setTitle: (v: string) => void;
  setSubtitle: (v: string) => void;
  cover: CoverKind;
  setCover: (c: CoverKind) => void;
}) {
  return (
    <div className="rounded-[13px] border border-border bg-card p-[26px]">
      <div className="mb-1.5 text-xs font-semibold text-foreground">Template name</div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mb-4 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
      />
      <div className="mb-1.5 text-xs font-semibold text-foreground">Subtitle (optional)</div>
      <input
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
        className="mb-5 w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-faint outline-none transition-colors focus:border-primary"
      />
      <div className="mb-2.5 text-xs font-semibold text-foreground">Cover page style</div>
      <div className="grid grid-cols-2 gap-2.5">
        {COVER_OPTIONS.map((opt) => {
          const active = cover === opt.kind;
          return (
            <div
              key={opt.kind}
              onClick={() => setCover(opt.kind)}
              className={`cursor-pointer rounded-[10px] border-[1.5px] p-3 transition-colors ${
                active ? "border-primary bg-[oklch(93%_0.03_55)]" : "border-border hover:border-primary/50"
              }`}
            >
              <CoverSwatch kind={opt.kind} />
              <div className="text-[12.5px] font-semibold text-foreground">{opt.label}</div>
              <div className="text-[11px] text-faint">{opt.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionsStep() {
  return (
    <div className="flex flex-col gap-3">
      <div className="mb-0.5 text-xs text-faint">
        Drag to reorder. Click a token below to insert it into the body text.
      </div>

      <div className="rounded-[13px] border border-border bg-card px-[18px] py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13.5px] font-semibold text-foreground">Executive summary</span>
          <Chip>Text only</Chip>
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          Overview of the site visit for <Tok>{"{{project_name}}"}</Tok> on{" "}
          <Tok>{"{{report_date}}"}</Tok>.
        </div>
      </div>

      <div className="rounded-[13px] border border-border bg-card px-[18px] py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13.5px] font-semibold text-foreground">Observations</span>
          <Chip>Text + photos</Chip>
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          Notes from the crew, plus supporting photos from today&rsquo;s visit.
        </div>
      </div>

      <div className="rounded-[13px] border border-border bg-card px-[18px] py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13.5px] font-semibold text-foreground">Photos</span>
          <Chip>Photo grid</Chip>
        </div>
        <div className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
          All photos tagged to this visit, in a grid.
        </div>
      </div>

      <div className="flex cursor-pointer flex-col items-center justify-center rounded-[13px] border border-dashed border-border bg-card p-3.5 text-faint transition-colors hover:border-primary">
        <div className="text-[12.5px] font-medium">+ Add section</div>
      </div>
    </div>
  );
}

function PlaceholdersStep() {
  const tokens = [
    "project_name",
    "project_address",
    "author_name",
    "report_date",
    "photo_count",
  ];
  return (
    <div className="rounded-[13px] border border-border bg-card p-[26px]">
      <p className="mb-4 text-[12.5px] text-muted-foreground">
        Placeholders are tokens like <Tok>{"{{project_name}}"}</Tok> that get replaced with
        real project data when the template is used.
      </p>
      <div className="mb-[18px] flex flex-wrap gap-2">
        {tokens.map((t) => (
          <span
            key={t}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] bg-[oklch(93%_0.025_200)] px-[9px] py-[5px] font-mono text-[10.5px] text-[oklch(38%_0.1_200)] transition-colors hover:bg-[oklch(90%_0.03_200)]"
          >
            {"{{" + t + "}}"} <XIcon />
          </span>
        ))}
      </div>
      <div className="flex gap-2.5">
        <div className="flex-grow rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-faint">
          e.g. client_name
        </div>
        <button className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40">
          + Add
        </button>
      </div>
    </div>
  );
}

function WizardView({
  title,
  subtitle,
  setTitle,
  setSubtitle,
  step,
  setStep,
  cover,
  setCover,
  onClose,
  onSave,
}: {
  title: string;
  subtitle: string;
  setTitle: (v: string) => void;
  setSubtitle: (v: string) => void;
  step: number;
  setStep: (n: number) => void;
  cover: CoverKind;
  setCover: (c: CoverKind) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const dotClass = (state: "done" | "idle") =>
    state === "idle" ? "bg-muted text-faint" : "bg-primary text-primary-foreground";

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      {/* Breadcrumb */}
      <div className="mb-4 text-[12.5px] text-faint">
        <a className="cursor-pointer text-primary hover:underline" onClick={onClose}>
          Documents
        </a>{" "}
        &nbsp;/&nbsp; New template
      </div>

      {/* Step dots */}
      <div className="mb-7 flex items-center gap-3.5" style={{ maxWidth: 520 }}>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${dotClass(step >= 1 ? "done" : "idle")}`}
        >
          1
        </span>
        <span className={`h-0.5 flex-1 rounded-full ${step > 1 ? "bg-primary" : "bg-border"}`} />
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${dotClass(step >= 2 ? "done" : "idle")}`}
        >
          2
        </span>
        <span className={`h-0.5 flex-1 rounded-full ${step > 2 ? "bg-primary" : "bg-border"}`} />
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${dotClass(step >= 3 ? "done" : "idle")}`}
        >
          3
        </span>
      </div>
      <div className="mb-2 flex gap-9 text-[11.5px] font-semibold text-faint">
        <span className={step === 1 ? "text-foreground" : ""}>Basics</span>
        <span className={step === 2 ? "text-foreground" : ""}>Sections</span>
        <span className={step === 3 ? "text-foreground" : ""}>Placeholders</span>
      </div>

      <div className="mt-[22px] grid grid-cols-1 gap-7 lg:grid-cols-[1fr_420px]">
        {/* Left: step content */}
        <div>
          {step === 1 && (
            <BasicsStep
              title={title}
              subtitle={subtitle}
              setTitle={setTitle}
              setSubtitle={setSubtitle}
              cover={cover}
              setCover={setCover}
            />
          )}
          {step === 2 && <SectionsStep />}
          {step === 3 && <PlaceholdersStep />}

          <div className="mt-6 flex items-center justify-between">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="cursor-pointer rounded-lg border border-border px-3.5 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
              >
                Back
              </button>
            ) : (
              <span />
            )}
            <button
              onClick={step === 3 ? onSave : () => setStep(step + 1)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {step === 3 ? "Save changes" : "Next"}
            </button>
          </div>
        </div>

        {/* Right: live preview */}
        <div>
          <div className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-faint">
            Live preview
          </div>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-[0_10px_26px_rgba(20,15,5,0.06)]">
            <PreviewCover cover={cover} title={title} subtitle={subtitle} />
            <div className="flex flex-col gap-4 px-[26px] py-[22px]">
              <div>
                <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-faint">
                  Executive summary
                </div>
                <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
                  Overview of the site visit, completed on time and photo-documented.
                </p>
              </div>
              <div>
                <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-faint">
                  Observations
                </div>
                <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
                  Field notes from the crew, with photos attached.
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-faint">
                  Photos
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="aspect-square rounded-[6px] bg-muted" />
                  <div className="aspect-square rounded-[6px] bg-muted" />
                  <div className="aspect-square rounded-[6px] bg-muted" />
                </div>
              </div>
            </div>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-[1.5] text-faint">
            This updates as you edit. What your client sees is exactly what you&rsquo;re
            building here.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Library page (list <-> wizard), real data ---- */

export function DocumentLibraryContent({
  initialTab = "documents",
  createTick,
  onCreate,
}: {
  /** Which sub-tab a deep link (/templates?docTab=reports) wants open. */
  initialTab?: SubTab;
  /** Incremented by the hub's "New template" button. */
  createTick: number;
  onCreate: () => void;
}) {
  const { profile: company } = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.industry, company.trades),
    [company.industry, company.trades],
  );

  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DocTemplate[]>([]);
  const [reports, setReports] = useState<ReportTemplate[]>([]);
  const [subTab, setSubTab] = useState<SubTab>(initialTab);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [cover, setCover] = useState<CoverKind>("hero");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");

  useEffect(() => {
    setSubTab(initialTab);
  }, [initialTab]);

  const prevCreateTick = useRef(createTick);
  useEffect(() => {
    if (createTick > prevCreateTick.current) {
      void load();
      openWizard();
    }
    prevCreateTick.current = createTick;
  }, [createTick]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const [docRes, repRes] = await Promise.all([
      supabase
        .from("document_templates" as any)
        .select("id, name, body, archived, updated_at")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabase
        .from("report_templates" as any)
        .select("id, name, sections, archived, updated_at, category")
        .order("updated_at", { ascending: false })
        .limit(100),
    ]);

    setDocs(
      ((docRes.data as any[]) ?? [])
        .filter((d: any) => !d.archived)
        .map((d: any) => {
          const body = parseDocBody(d.body);
          return {
            id: d.id,
            name: d.name ?? "",
            archived: false,
            updated_at: d.updated_at ?? "",
            style: body.style,
            category: body.category ?? null,
            tokens: countTokens(body.html),
            excerpt: cardExcerpt(body.html, body.description),
          } as DocTemplate;
        }),
    );
    setReports(
      ((repRes.data as any[]) ?? [])
        .filter((r: any) => !r.archived)
        .map((r: any) => {
          const structure = parseReportTemplateStructure(r.sections);
          return {
            id: r.id,
            name: r.name ?? "",
            archived: false,
            updated_at: r.updated_at ?? "",
            sectionCount: structure.items.length,
            sectionList: structure.items.map((s) => ({
              heading: s.heading,
              layout: s.layout ?? "",
            })),
          } as ReportTemplate;
        }),
    );
    setLoading(false);
  }

  /** The company's top-ranked trade among the categories present. */
  const leadingCategory = useMemo(() => {
    const present = docs.map((d) => d.category || GENERAL_CATEGORY);
    if (!present.length) return null;
    return [...new Set(present)].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }, [docs, rank]);

  const openWizard = () => {
    setTitle("");
    setSubtitle("");
    setCover("hero");
    setStep(1);
    setWizardOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-10">
      {loading && docs.length === 0 && reports.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-faint">Loading templates&hellip;</div>
      ) : wizardOpen ? (
        <WizardView
          title={title}
          subtitle={subtitle}
          setTitle={setTitle}
          setSubtitle={setSubtitle}
          step={step}
          setStep={setStep}
          cover={cover}
          setCover={setCover}
          onClose={() => setWizardOpen(false)}
          onSave={() => {
            toast.success("Template saved");
            setWizardOpen(false);
          }}
        />
      ) : (
        <>
          <SubTabStrip
            value={subTab}
            docCount={docs.length}
            reportCount={reports.length}
            onChange={setSubTab}
          />
          {subTab === "documents" ? (
            <DocumentsGrid
              docs={docs}
              leadingCategory={leadingCategory}
              onEdit={openWizard}
              onCreate={onCreate}
            />
          ) : (
            <ReportsView reports={reports} onEdit={openWizard} onCreate={onCreate} />
          )}
        </>
      )}
    </div>
  );
}
