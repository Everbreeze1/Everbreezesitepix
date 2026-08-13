import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  ClipboardList,
  Droplets,
  FileText,
  HardHat,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listDocumentTemplates,
  getDocumentTemplate,
  type DocumentTemplateSummary,
} from "@/lib/project-pages.functions";

type Filter = "all" | "team" | "example";

const TEAM_SECTION = "Your Company";

/**
 * Trade sections lead, general document shapes follow.
 *
 * The picker used to render every template as one flat scrolling list — thirty
 * rows of near-identical names, alphabetical, with a team's own copies and
 * copies-of-copies at the top. Finding "the one an HVAC tech fills in on a
 * service call" meant reading all of it.
 *
 * So the first question the dialog asks is now "what trade are you", answered
 * by nine collapsed rows you can take in at a glance, and only the section you
 * open lists templates. That makes the order here load-bearing: a plumber must
 * not have to scroll past insurance and field admin to reach Plumbing.
 *
 * The strings must match the `category` seeded in
 * supabase/migrations/*_document_templates_*_seed.sql. A category that is not
 * listed here still renders — it sorts alphabetically after these — so a new
 * seeded trade degrades to "in the right place-ish", never to "missing".
 */
const CATEGORY_ORDER = [
  "Electrical",
  "HVAC",
  "Plumbing",
  "Roofing & Exterior",
  "Restoration",
  "Cleaning",
  "Field Reports",
  "Field Admin",
  "Insurance & Adjusting",
];

const CATEGORY_ICON: Record<string, LucideIcon> = {
  [TEAM_SECTION]: Building2,
  Electrical: Zap,
  HVAC: Wind,
  Plumbing: Droplets,
  "Roofing & Exterior": HardHat,
  Restoration: Waves,
  Cleaning: Sparkles,
  "Field Reports": ClipboardList,
  "Field Admin": Briefcase,
  "Insurance & Adjusting": ShieldCheck,
};

function rank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

/**
 * "HVAC Service Call Report" under the HVAC heading reads as "Service Call
 * Report" — the trade is already the row you are looking at.
 *
 * Only the collapsed summary line is shortened. The template keeps its full
 * name everywhere else because that name becomes the created page's title, and
 * a document filed as "Service Call Report" says nothing on its own.
 */
function withoutTradePrefix(name: string, heading: string): string {
  const prefix = `${heading.toLowerCase()} `;
  return name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length) : name;
}

export function ChoosePageTemplateDialog({
  open,
  onOpenChange,
  applying,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applying: boolean;
  onUse: (templateId: string) => void;
}) {
  const [templates, setTemplates] = useState<DocumentTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ id: string; name: string; html: string } | null>(null);
  /** Per-row, not global: a slow preview must not blank the list behind it. */
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setSearch("");
    setOpenSections([]);
    setUsingId(null);
    (async () => {
      try {
        const res = await listDocumentTemplates();
        if (!cancelled) setTemplates(res.templates);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Could not load templates");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (filter === "team" && t.isExample) return false;
      if (filter === "example" && !t.isExample) return false;
      // Match the trade and the summary too — searching "roof" or "invoice"
      // should find a template whose name says neither.
      if (q) {
        const haystack = `${t.name} ${t.category ?? ""} ${t.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [templates, filter, search]);

  /**
   * "Your Company" first, then the built-ins split by trade category — the
   * category lives in the template's body rather than being spelled out in
   * every name, so the headings do that work instead.
   */
  const sections = useMemo<Array<[string, DocumentTemplateSummary[]]>>(() => {
    const mine = visible.filter((t) => !t.isExample);
    const groups: Array<[string, DocumentTemplateSummary[]]> = mine.length
      ? [[TEAM_SECTION, mine]]
      : [];

    const byCategory = new Map<string, DocumentTemplateSummary[]>();
    for (const t of visible.filter((x) => x.isExample)) {
      const key = t.category ?? "Templates";
      const list = byCategory.get(key);
      if (list) list.push(t);
      else byCategory.set(key, [t]);
    }
    for (const [cat, items] of Array.from(byCategory.entries()).sort(
      (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
    )) {
      groups.push([cat, items]);
    }
    return groups.filter(([, items]) => items.length > 0);
  }, [visible]);

  /*
   * Searching has to open what it found, or the results hide inside collapsed
   * sections and the box reads as broken. Same for a single section — there is
   * nothing left to scan, so making the user click it is pure friction.
   *
   * `sections` is read through a ref and left out of the deps deliberately: it
   * is a fresh array every render, and depending on it would slam every section
   * back open the moment anything else re-rendered. The three things that
   * genuinely change what "the right sections" means are the deps.
   */
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const query = search.trim();
  useEffect(() => {
    const headings = sectionsRef.current.map(([heading]) => heading);
    setOpenSections(query || headings.length === 1 ? headings : []);
  }, [query, filter, templates]);

  const allExpanded = sections.length > 0 && sections.every(([h]) => openSections.includes(h));

  async function openPreview(id: string) {
    setPreviewingId(id);
    try {
      const t = await getDocumentTemplate({ data: { templateId: id } });
      setPreview({ id: t.id, name: t.name, html: t.html });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open template");
    } finally {
      setPreviewingId(null);
    }
  }

  /** Straight to a new page, skipping the preview — the two-click path. */
  function applyTemplate(id: string) {
    setUsingId(id);
    onUse(id);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !applying && onOpenChange(v)}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {preview ? (
          <>
            <div className="flex items-center justify-between border-b py-4 pl-6 pr-16">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreview(null)}
                disabled={applying}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              <Button size="sm" onClick={() => applyTemplate(preview.id)} disabled={applying}>
                {applying && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Use Template
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
              <div className="mx-auto max-w-[720px] rounded-sm border border-border bg-card p-10 shadow-sm">
                <h2 className="mb-4 text-2xl font-extrabold text-foreground">{preview.name}</h2>
                <div
                  className="tiptap prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: preview.html }}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="border-b px-6 pb-4 pt-5 text-left">
              <DialogTitle>Choose Page Template</DialogTitle>
              <DialogDescription>
                Open your trade to see its templates. Merge fields like{" "}
                <code>{"{{project_name}}"}</code> fill in automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="border-b px-6 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search every trade — “panel”, “water heater”, “invoice”"
                  className="h-9 pl-8"
                />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex gap-1.5">
                  {(
                    [
                      { key: "all", label: "All" },
                      { key: "team", label: "Your Company" },
                      { key: "example", label: "Example Templates" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-bold transition",
                        filter === f.key
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-accent",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSections(allExpanded ? [] : sections.map(([heading]) => heading))
                    }
                    className="shrink-0 text-xs font-bold text-muted-foreground hover:text-foreground"
                  >
                    {allExpanded ? "Collapse all" : "Expand all"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : visible.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  {templates.length === 0
                    ? "No document templates yet. Create them in Settings → Document Templates."
                    : "No templates match."}
                </p>
              ) : (
                <Accordion
                  type="multiple"
                  value={openSections}
                  onValueChange={setOpenSections}
                  className="space-y-2"
                >
                  {sections.map(([heading, items]) => {
                    const Icon = CATEGORY_ICON[heading] ?? FileText;
                    return (
                      <AccordionItem
                        key={heading}
                        value={heading}
                        className="overflow-hidden rounded-xl border border-border bg-card data-[state=open]:border-primary/30"
                      >
                        <AccordionTrigger className="gap-3 px-3 py-2.5 hover:no-underline">
                          <span className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10">
                              <Icon className="h-4 w-4 text-primary" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-foreground">
                                {heading}
                              </span>
                              {/* Derived from the templates themselves rather than
                                  hardcoded copy, so it cannot drift from the seed. */}
                              <span className="block truncate text-xs font-normal text-muted-foreground">
                                {items.map((t) => withoutTradePrefix(t.name, heading)).join(" · ")}
                              </span>
                            </span>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                              {items.length}
                            </span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-1.5 px-3 pb-3 pt-0">
                          {items.map((t) => (
                            <div
                              key={t.id}
                              className="flex items-center gap-2 rounded-lg border border-border p-2 transition hover:border-primary/40 hover:bg-accent/40"
                            >
                              <button
                                type="button"
                                onClick={() => openPreview(t.id)}
                                disabled={applying}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              >
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10">
                                  {previewingId === t.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                  ) : (
                                    <FileText className="h-4 w-4 text-primary" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-bold text-foreground">
                                    {t.name}
                                  </span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {t.description ??
                                      (t.fields.length > 0
                                        ? `${t.fields.length} merge field${t.fields.length === 1 ? "" : "s"}`
                                        : "No merge fields")}
                                  </span>
                                </span>
                              </button>
                              {/* The whole point is speed: preview is for
                                  deciding, this is for the tech who already
                                  knows which sheet they fill in every day. */}
                              <Button
                                size="sm"
                                variant="secondary"
                                className="shrink-0"
                                onClick={() => applyTemplate(t.id)}
                                disabled={applying}
                              >
                                {applying && usingId === t.id && (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                )}
                                Use
                              </Button>
                            </div>
                          ))}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
