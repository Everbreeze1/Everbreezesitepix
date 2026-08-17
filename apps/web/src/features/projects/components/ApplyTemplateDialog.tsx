import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { GENERAL_CATEGORY, makeCategoryRank } from "@/lib/template-categories";
import { getMyTeam } from "@/lib/teams.functions";
import { toast } from "sonner";
import {
  Loader2,
  FileText,
  ListChecks,
  Sparkles,
  Wand2,
  Download,
  Check,
  Search,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectName: string;
  projectAddress?: string | null;
  onApplied?: () => void;
}

type DocTpl = {
  id: string;
  name: string;
  body: any;
  fields: string[];
};
type ChkTpl = {
  id: string;
  name: string;
  description: string | null;
  /** Optional as well as nullable - see ChecklistTemplatesPage. */
  category?: string | null;
};

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectAddress,
  onApplied,
}: Props) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const fetchTeam = getMyTeam;
  const [tab, setTab] = useState<"documents" | "checklists">("documents");
  const [loading, setLoading] = useState(false);
  const [docs, setDocs] = useState<DocTpl[]>([]);
  const [chks, setChks] = useState<ChkTpl[]>([]);
  const { profile: company } = useCompanySetup();
  const [q, setQ] = useState("");
  const [applying, setApplying] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const team = (await fetchTeam().catch(() => null)) as any;
        if (!cancelled) setCompanyName(team?.team?.name ?? "");
        const [d, c] = await Promise.all([
          supabase
            .from("document_templates" as any)
            .select("id, name, body, fields, archived")
            .order("updated_at", { ascending: false }),
          supabase
            .from("checklist_templates" as any)
            .select("id, name, description, archived, category")
            .order("created_at", { ascending: false }),
        ]);
        if (cancelled) return;
        setDocs(((d.data as any[]) ?? []).filter((x) => !x.archived) as DocTpl[]);
        setChks(((c.data as any[]) ?? []).filter((x) => !x.archived) as ChkTpl[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fetchTeam]);

  const values = useMemo<Record<string, string>>(
    () => ({
      project_name: projectName,
      project_address: projectAddress ?? "",
      date: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      prepared_by: profile?.full_name || user?.email || "",
      company_name: companyName,
    }),
    [projectName, projectAddress, profile, user, companyName],
  );

  const filledDocs = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? docs.filter((d) => d.name.toLowerCase().includes(query)) : docs;
  }, [docs, q]);
  /*
   * Filtered by the search box, then ordered with the company's own trade
   * first - the same ordering every other template picker uses. Sorting after
   * filtering rather than before keeps the trade order intact within whatever
   * the search left behind.
   */
  const filledChks = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matched = query ? chks.filter((c) => c.name.toLowerCase().includes(query)) : chks;
    const rank = makeCategoryRank(company.industry, company.trades);
    return [...matched].sort(
      (a, b) =>
        rank(a.category || GENERAL_CATEGORY) - rank(b.category || GENERAL_CATEGORY) ||
        a.name.localeCompare(b.name),
    );
  }, [chks, q, company.industry, company.trades]);

  function fill(html: string): string {
    return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) => {
      const v = values[String(k).toLowerCase()];
      return v ? v : m;
    });
  }

  async function applyDocument(t: DocTpl) {
    setApplying(t.id);
    try {
      const html = fill((t.body?.html as string) ?? "");
      const title = `${t.name} - ${new Date().toLocaleDateString()}`;
      // Site logs table lets us persist a project doc quickly.
      // We stash the HTML in the notes bag under a reserved key so it can be exported.
      const { error } = await (supabase as any).from("project_site_logs").insert({
        project_id: projectId,
        title,
        photo_ids: [],
        notes: { __doc_html__: html, __doc_source_template__: t.name },
      });
      if (error) throw error;
      toast.success(`Applied "${t.name}" to this project`);
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't apply template");
    } finally {
      setApplying(null);
    }
  }

  async function applyChecklist(t: ChkTpl) {
    if (!user) return;
    setApplying(t.id);
    try {
      const { data: items, error: readErr } = await supabase
        .from("checklist_template_items" as any)
        .select("position, label, required, item_type, description")
        .eq("template_id", t.id)
        .order("position", { ascending: true });
      // Without this a failed read looked like an empty template, and the crew
      // got a success toast over a checklist with nothing in it.
      if (readErr) throw readErr;
      const { data: created, error } = await supabase
        .from("project_checklists" as any)
        .insert({
          project_id: projectId,
          template_id: t.id,
          name: t.name,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("Failed");
      // Renumber from zero rather than carrying the template's stored
      // positions across - rows already arrive ordered, and a template whose
      // own positions have gaps or duplicates would otherwise hand the new
      // checklist a list the reorder controls can't move. Matches
      // ProjectChecklists.applyTemplate.
      const rows = ((items as any[]) ?? []).map((it: any, idx: number) => ({
        checklist_id: (created as any).id,
        position: idx,
        label: it.label,
        required: it.required ?? false,
        item_type: it.item_type ?? "checkbox",
        description: it.description ?? null,
      }));
      if (rows.length) {
        // Throws into the catch below. Discarding this told the crew the
        // inspection had been added to the job; they opened it on site and it
        // had no items, with an orphan parent row left behind.
        const { error: itemsErr } = await supabase
          .from("project_checklist_items" as any)
          .insert(rows);
        if (itemsErr) {
          // Compensating delete for the parent created just above. Throwing
          // without it leaves an item-less checklist on the project AND keeps
          // the dialog open, so the user's natural retry stacks another one on
          // every click. `ProjectChecklists.applyTemplate` rolls back the same
          // pair of tables for exactly this reason.
          const { error: cleanupErr } = await supabase
            .from("project_checklists" as any)
            .delete()
            .eq("id", (created as any).id);
          if (cleanupErr)
            console.warn(
              "Could not roll back empty project checklist",
              (created as any).id,
              cleanupErr,
            );
          throw itemsErr;
        }
      }
      toast.success(`Added "${t.name}" checklist`);
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't apply template");
    } finally {
      setApplying(null);
    }
  }

  function previewDownload(t: DocTpl) {
    const html = fill((t.body?.html as string) ?? "");
    const title = `${t.name} - ${projectName}`;
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) {
      toast.error("Popup blocked - allow popups to preview.");
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        @page { size: Letter; margin: 0.85in; }
        body { font-family: ui-serif, Georgia, "Times New Roman", serif; color: #111827; font-size: 12pt; line-height: 1.6; }
        h1 { font-size: 22pt; margin: 0 0 8pt; } h2 { font-size: 15pt; margin: 16pt 0 6pt; border-bottom: 1px solid #e5e7eb; padding-bottom: 4pt; }
        h3 { font-size: 12.5pt; margin: 12pt 0 4pt; } p { margin: 6pt 0; }
        ul, ol { margin: 4pt 0 6pt 20pt; } hr { border: 0; border-top: 1px solid #e5e7eb; margin: 12pt 0; }
      </style></head><body>${html}<script>window.onload=()=>{setTimeout(()=>window.print(),300)};</script></body></html>`);
    win.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Apply a template to {projectName}
          </DialogTitle>
        </DialogHeader>

        <div className="px-5 pt-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <div className="flex flex-wrap items-center gap-2">
              <TabsList>
                <TabsTrigger value="documents" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Documents
                </TabsTrigger>
                <TabsTrigger value="checklists" className="gap-1.5">
                  <ListChecks className="h-3.5 w-3.5" /> Checklists
                </TabsTrigger>
              </TabsList>
              <div className="relative ml-auto max-w-xs flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search templates…"
                  className="h-8 pl-7 text-sm"
                />
              </div>
            </div>

            <div className="mt-3">
              {loading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[54vh] pr-2">
                  <TabsContent value="documents" className="mt-0 space-y-2">
                    {filledDocs.length === 0 ? (
                      <EmptyRow message="No document templates yet. Create one under Templates → Documents." />
                    ) : (
                      filledDocs.map((t) => (
                        <Card key={t.id} className="flex items-center gap-3 p-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{t.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {t.fields.length} placeholder{t.fields.length === 1 ? "" : "s"} · will
                              auto-fill project name, address, date, author
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" onClick={() => previewDownload(t)}>
                            <Download className="mr-1 h-3.5 w-3.5" /> Preview
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => applyDocument(t)}
                            disabled={applying === t.id}
                          >
                            {applying === t.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-3.5 w-3.5" />
                            )}
                            Apply
                          </Button>
                        </Card>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="checklists" className="mt-0 space-y-2">
                    {filledChks.length === 0 ? (
                      <EmptyRow message="No checklist templates yet. Create one under Templates → Checklists." />
                    ) : (
                      filledChks.map((t) => (
                        <Card key={t.id} className="flex items-center gap-3 p-3">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                            <ListChecks className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{t.name}</div>
                            {t.description && (
                              <div className="truncate text-xs text-muted-foreground">
                                {t.description}
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => applyChecklist(t)}
                            disabled={applying === t.id}
                          >
                            {applying === t.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Apply
                          </Button>
                        </Card>
                      ))
                    )}
                  </TabsContent>
                </ScrollArea>
              )}
            </div>
          </Tabs>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <p className="mr-auto text-xs text-muted-foreground">
            Placeholders like <span className="font-mono">{`{{project_name}}`}</span> are
            auto-filled from this project.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
      <Badge variant="outline" className="text-[10px]">
        Empty
      </Badge>
      {message}
    </div>
  );
}
