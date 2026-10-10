import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/everlumen/client";
import { parseReportTemplateStructure } from "@everlumen/shared";
import { GENERAL_CATEGORY, makeCategoryRank } from "@/lib/template-categories";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useDocumentTemplateEditing,
  type DocumentTemplate as DocumentTemplateRow,
} from "@/features/settings/components/DocumentTemplatesManager";
import {
  TemplateWizard as ReportTemplateWizard,
  saveReportTemplate,
  type ReportTemplate as ReportTemplateRow,
} from "@/features/settings/components/ReportTemplatesManager";

/*
 * The Documents page, laid out exactly as the Main-html reference
 * (public/Main-html/DocumentsContent.dc.html): a Document-template /
 * Report-template sub-tab strip, trade filter pills, a grid of template cards,
 * and a reports rail with a detail pane.
 *
 * Unlike the reference (a static mockup), the cards come from the account's
 * real document_templates and report_templates. Badge type, token count and
 * the preview excerpt are derived from each template's stored body.
 *
 * Authoring is the real thing, not the reference's mocked wizard (which saved
 * nothing): a document card opens the rich text editor on that template, New
 * template runs the guided setup that writes the row, and a report template
 * opens the report wizard on it - the same editors DocumentTemplatesManager
 * and ReportTemplatesManager use.
 */

type SubTab = "documents" | "reports";
type BadgeType = "Report" | "Invoice" | "Site log" | "Document";

interface DocTemplate {
  /** The stored row, handed to the editor as-is. */
  row: DocumentTemplateRow;
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
  /** The stored row, handed to the report wizard as-is. */
  row: ReportTemplateRow;
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
  if (!body || typeof body !== "object")
    return { style: "report", html: "", description: "", category: null };
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

/* ---- Icons (paths from the mockup's inline SVGs) ---- */

function PlusIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
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
  onEdit: (doc: DocTemplate) => void;
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
        {docs
          .filter(
            (d) =>
              trade === "all" ||
              d.category === trade ||
              (!d.category && trade === GENERAL_CATEGORY),
          )
          .map((doc) => (
            <div
              key={doc.id}
              onClick={() => onEdit(doc)}
              className="flex cursor-pointer flex-col gap-[11px] rounded-[13px] border border-border bg-card p-[18px] transition-colors hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <TypeBadge type={badgeForStyle(doc.style)} />
                <span className="font-mono text-[11px] text-faint">{doc.tokens} tokens</span>
              </div>
              <div className="text-[14.5px] font-semibold text-foreground">{doc.name}</div>
              {doc.excerpt && <div className="text-xs leading-[1.5] text-faint">{doc.excerpt}</div>}
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
  onEdit: (report: ReportTemplate) => void;
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
                onClick={() => onEdit(selected)}
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

/* ---- Library page, real data ---- */

export function DocumentLibraryContent({
  initialTab = "documents",
  teamId,
  canManage,
  createTick,
  onCreate,
}: {
  /** Which sub-tab a deep link (/templates?docTab=reports) wants open. */
  initialTab?: SubTab;
  teamId: string | null;
  /** Whether this member may write templates; others are sent to onCreate. */
  canManage: boolean;
  /** Incremented by the hub's "New template" button. */
  createTick: number;
  onCreate: () => void;
}) {
  const { user } = useAuth();
  const { profile: company } = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.industry, company.trades),
    [company.industry, company.trades],
  );

  const [loading, setLoading] = useState(true);
  const [docRows, setDocRows] = useState<DocumentTemplateRow[]>([]);
  const [reports, setReports] = useState<ReportTemplate[]>([]);
  const [subTab, setSubTab] = useState<SubTab>(initialTab);
  /** The report wizard: closed, a new template, or the template being edited. */
  const [reportWizard, setReportWizard] = useState<{ initial: ReportTemplateRow | null } | null>(
    null,
  );

  const editing = useDocumentTemplateEditing({ teamId, items: docRows, onChanged: load });

  /*
   * The editor is desktop-only (see DocumentTemplatesManager): on a phone every
   * route into it explains where it lives instead of opening a cramped copy.
   */
  const isMobile = useIsMobile();
  function editorNeedsDesktop(): boolean {
    if (!isMobile) return false;
    toast.info("Template editing needs a bigger screen", {
      description:
        "Open Templates on a desktop or tablet to write or change one. On a phone you can still use any template on a project.",
    });
    return true;
  }

  useEffect(() => {
    setSubTab(initialTab);
  }, [initialTab]);

  /** New template, on whichever sub-tab is showing. */
  function startCreate() {
    if (!canManage) return onCreate();
    if (editorNeedsDesktop()) return;
    if (subTab === "reports") setReportWizard({ initial: null });
    else editing.openCreate();
  }

  const prevCreateTick = useRef(createTick);
  useEffect(() => {
    if (createTick > prevCreateTick.current) startCreate();
    prevCreateTick.current = createTick;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createTick]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function load() {
    let docQuery = supabase
      .from("document_templates" as any)
      .select("*")
      .order("updated_at", { ascending: false });
    if (teamId) docQuery = docQuery.or(`team_id.eq.${teamId},team_id.is.null`);
    const [docRes, repRes] = await Promise.all([
      docQuery,
      supabase
        .from("report_templates" as any)
        .select(
          "id, team_id, created_by, name, subtitle, sections, archived, created_at, updated_at, category",
        )
        .order("updated_at", { ascending: false })
        .limit(100),
    ]);

    setDocRows((docRes.data as unknown as DocumentTemplateRow[]) ?? []);
    setReports(
      ((repRes.data as unknown as ReportTemplateRow[]) ?? [])
        .filter((r) => !r.archived)
        .map((r) => {
          const structure = parseReportTemplateStructure(r.sections);
          return {
            row: r,
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

  /*
   * Built-ins the company has made its own version of. Editing an example
   * writes a team copy (examples are shared by every company), and the copy
   * stands in for the example on the page rather than sitting beside it - the
   * same rule as DocumentTemplatesManager, so Edit never grows a second card.
   */
  const docs = useMemo(() => {
    const shadowed = new Set<string>();
    for (const r of docRows) {
      if (r.team_id === null || r.archived) continue;
      const from = (r.body as { copiedFrom?: unknown } | null)?.copiedFrom;
      if (typeof from === "string") shadowed.add(from);
    }
    return docRows
      .filter((r) => !r.archived && !(r.team_id === null && shadowed.has(r.id)))
      .map((r) => {
        const body = parseDocBody(r.body);
        return {
          row: r,
          id: r.id,
          name: r.name ?? "",
          archived: false,
          updated_at: r.updated_at ?? "",
          style: body.style,
          category: body.category ?? null,
          tokens: countTokens(body.html),
          excerpt: cardExcerpt(body.html, body.description),
        } as DocTemplate;
      });
  }, [docRows]);

  /** The company's top-ranked trade among the categories present. */
  const leadingCategory = useMemo(() => {
    const present = docs.map((d) => d.category || GENERAL_CATEGORY);
    if (!present.length) return null;
    return [...new Set(present)].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }, [docs, rank]);

  /** Members without template rights can browse; only managers edit. */
  function cannotEdit(): boolean {
    if (canManage) return false;
    toast.info("Ask your account owner or admin to change templates.");
    return true;
  }

  function editDoc(doc: DocTemplate) {
    if (cannotEdit()) return;
    if (editorNeedsDesktop()) return;
    void editing.edit(doc.row);
  }

  function editReport(report: ReportTemplate) {
    if (cannotEdit()) return;
    if (editorNeedsDesktop()) return;
    setReportWizard({ initial: report.row });
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 sm:px-10">
      {loading && docs.length === 0 && reports.length === 0 ? (
        <div className="py-16 text-center text-[13px] text-faint">Loading templates&hellip;</div>
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
              onEdit={editDoc}
              onCreate={startCreate}
            />
          ) : (
            <ReportsView reports={reports} onEdit={editReport} onCreate={startCreate} />
          )}
        </>
      )}

      {editing.dialogs}

      {reportWizard && (
        <ReportTemplateWizard
          open
          onOpenChange={(open) => {
            if (!open) setReportWizard(null);
          }}
          initial={reportWizard.initial}
          onSave={async (payload) => {
            const id = await saveReportTemplate({
              editingId: reportWizard.initial?.id ?? null,
              payload,
              teamId,
              userId: user?.id,
            });
            if (!id) return false;
            await load();
            return true;
          }}
        />
      )}
    </div>
  );
}
