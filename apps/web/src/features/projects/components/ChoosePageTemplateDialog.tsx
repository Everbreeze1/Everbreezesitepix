import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Search, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  const [preview, setPreview] = useState<{ id: string; name: string; html: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setSearch("");
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
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [templates, filter, search]);

  /** Grouped so "Your Company" always reads above the built-in examples. */
  const sections = useMemo<Array<[string, DocumentTemplateSummary[]]>>(() => {
    const groups: Array<[string, DocumentTemplateSummary[]]> = [
      ["Your Company", visible.filter((t) => !t.isExample)],
      ["Example Templates", visible.filter((t) => t.isExample)],
    ];
    return groups.filter(([, items]) => items.length > 0);
  }, [visible]);

  async function openPreview(id: string) {
    setPreviewLoading(true);
    try {
      const t = await getDocumentTemplate({ data: { templateId: id } });
      setPreview({ id: t.id, name: t.name, html: t.html });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open template");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !applying && onOpenChange(v)}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {preview ? (
          <>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={applying}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              <Button size="sm" onClick={() => onUse(preview.id)} disabled={applying}>
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
                Start from a saved layout. Merge fields like <code>{"{{project_name}}"}</code> fill in
                automatically.
              </DialogDescription>
            </DialogHeader>

            <div className="border-b px-6 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search for a template"
                  className="h-9 pl-8"
                />
              </div>
              <div className="mt-3 flex gap-1.5">
                {([
                  { key: "all", label: "All" },
                  { key: "team", label: "Your Company" },
                  { key: "example", label: "Example Templates" },
                ] as const).map((f) => (
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
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading || previewLoading ? (
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
                <div className="space-y-5">
                  {sections.map(([heading, items]) => (
                    <div key={heading}>
                      <p className="mb-2 rounded bg-muted px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {heading}
                      </p>
                      <div className="space-y-1.5">
                        {items.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => openPreview(t.id)}
                            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:border-primary/40 hover:bg-accent/40"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10">
                              <FileText className="h-4 w-4 text-primary" />
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
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
