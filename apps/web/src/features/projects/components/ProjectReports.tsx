import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  Image as ImageIcon,
  Copy,
  ExternalLink,
  Pencil,
  Eye,
  EyeOff,
  Download,
  MoreHorizontal,
  Sparkles,
  ListChecks,
} from "lucide-react";
import { ProjectSiteLogs } from "@/features/projects/components/ProjectSiteLogs";
import { ApplyTemplateDialog } from "@/features/projects/components/ApplyTemplateDialog";
import { useNavigate } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { sitepixApi } from "@/lib/sitepix-api";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";

export interface ReportPhotoRef {
  id: string;
  url: string;
  caption?: string | null;
  taken_at?: string | null;
}

interface ProjectReport {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  summary: string | null;
  photo_ids: string[];
  share_token: string;
  allow_download: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Props {
  projectId: string;
  projectName: string;
  projectPhotos: ReportPhotoRef[];
}

export function ProjectReports({ projectId, projectName, projectPhotos }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [reports, setReports] = useState<ProjectReport[]>([]);
  const [completedChecklists, setCompletedChecklists] = useState<
    Array<{ id: string; name: string; completed_at: string; snapshot: any }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"reports" | "checklists" | "sitelogs">("reports");
  const [applyOpen, setApplyOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftPhotosPerPage, setDraftPhotosPerPage] = useState<1 | 2 | 3 | 4>(2);
  const [draftCoverEnabled, setDraftCoverEnabled] = useState(true);
  const [draftShowProject, setDraftShowProject] = useState(true);
  const [draftShowAddress, setDraftShowAddress] = useState(true);
  const [draftShowDate, setDraftShowDate] = useState(true);
  const [draftShowAuthor, setDraftShowAuthor] = useState(true);

  const photoMap = useMemo(() => {
    const m = new Map<string, ReportPhotoRef>();
    for (const p of projectPhotos) m.set(p.id, p);
    return m;
  }, [projectPhotos]);

  async function load() {
    setLoading(true);
    const [reportsRes, checklistsRes] = await Promise.all([
      (supabase as any)
        .from("project_reports")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("project_checklists")
        .select("id, name, completed_at, snapshot")
        .eq("project_id", projectId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false }),
    ]);
    if (reportsRes.error)
      toast.error("Couldn't load reports", { description: reportsRes.error.message });
    else setReports((reportsRes.data ?? []) as ProjectReport[]);
    if (!checklistsRes.error) setCompletedChecklists((checklistsRes.data ?? []) as any);
    setLoading(false);
  }

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projectId]);

  function openCreate() {
    setDraftTitle(`${projectName} report - ${new Date().toLocaleDateString()}`);
    setDraftPhotosPerPage(2);
    setDraftCoverEnabled(true);
    setDraftShowProject(true);
    setDraftShowAddress(true);
    setDraftShowDate(true);
    setDraftShowAuthor(true);
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!user) return;
    const title = draftTitle.trim() || `${projectName} report`;
    setCreating(true);
    const { data, error } = await (supabase as any)
      .from("project_reports")
      .insert({
        project_id: projectId,
        created_by: user.id,
        title,
        summary: null,
        photo_ids: [],
        include_project_info: true,
        allow_download: true,
        photos_per_page: draftPhotosPerPage,
        cover_enabled: draftCoverEnabled,
        cover_show_project_name: draftShowProject,
        cover_show_address: draftShowAddress,
        cover_show_date: draftShowDate,
        cover_show_author: draftShowAuthor,
      })
      .select("*")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("Couldn't create report", { description: error?.message });
      return;
    }
    setCreateOpen(false);
    navigate({
      to: "/projects/$projectId/reports/$reportId",
      params: { projectId, reportId: (data as ProjectReport).id },
    });
  }

  function openBuilder(r: ProjectReport) {
    navigate({
      to: "/projects/$projectId/reports/$reportId",
      params: { projectId, reportId: r.id },
    });
  }

  async function handleDelete(r: ProjectReport) {
    if (!(await confirm({ description: `Delete report "${r.title}"?`, variant: "destructive" }))) return;
    const { error } = await (supabase as any).from("project_reports").delete().eq("id", r.id);
    if (error) {
      toast.error("Couldn't delete", { description: error.message });
      return;
    }
    setReports((rs) => rs.filter((x) => x.id !== r.id));
    toast.success("Report deleted");
  }
  async function toggleRevoke(r: ProjectReport) {
    const revoked_at = r.revoked_at ? null : new Date().toISOString();
    const { error } = await (supabase as any)
      .from("project_reports")
      .update({ revoked_at })
      .eq("id", r.id);
    if (error) {
      toast.error("Couldn't update", { description: error.message });
      return;
    }
    setReports((rs) => rs.map((x) => (x.id === r.id ? { ...x, revoked_at } : x)));
    toast.success(revoked_at ? "Share link disabled" : "Share link re-enabled");
  }
  function shareUrl(token: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/share/reports/${token}`;
  }
  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <div className="mt-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <TabsList className="grid w-full grid-cols-3 gap-1 sm:inline-flex sm:w-auto">
            <TabsTrigger value="reports" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Reports
              {reports.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {reports.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="checklists" className="gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Checklists
              {completedChecklists.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {completedChecklists.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sitelogs" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Site Logs
            </TabsTrigger>
          </TabsList>
          <Button size="sm" variant="outline" onClick={() => setApplyOpen(true)}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Apply template
          </Button>
        </div>

        <TabsContent value="reports" className="mt-0">
          <section>
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">Reports</h2>
                  {reports.length > 0 && (
                    <Badge variant="secondary" className="ml-1">
                      {reports.length}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Client-ready PDFs built from your project photos.
                </p>
              </div>
              <Button size="sm" onClick={openCreate} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1 h-4 w-4" />
                )}
                New report
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : reports.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No reports yet"
                description="Create a sectioned client-ready report with photos and captions."
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="mr-1 h-4 w-4" /> New report
                  </Button>
                }
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((r) => {
                  const cover = r.photo_ids[0] ? photoMap.get(r.photo_ids[0]) : undefined;
                  const previewIds = r.photo_ids.slice(1, 4);
                  return (
                    <li key={r.id}>
                      <Card className="group flex h-full flex-col overflow-hidden transition hover:shadow-md">
                        <button
                          type="button"
                          onClick={() => openBuilder(r)}
                          className="relative block aspect-video w-full overflow-hidden bg-muted text-left"
                          aria-label={`Open ${r.title}`}
                        >
                          {cover?.url ? (
                            <img
                              src={cover.url}
                              alt=""
                              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <FileText className="h-8 w-8" />
                            </div>
                          )}
                          {r.revoked_at && (
                            <Badge
                              variant="outline"
                              className="absolute left-2 top-2 bg-background/90 text-xs"
                            >
                              Disabled
                            </Badge>
                          )}
                          {r.photo_ids.length > 0 && (
                            <Badge
                              variant="secondary"
                              className="absolute right-2 top-2 bg-background/90 text-xs"
                            >
                              <ImageIcon className="mr-1 h-3 w-3" />
                              {r.photo_ids.length}
                            </Badge>
                          )}
                        </button>

                        <div className="flex flex-1 flex-col p-3">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              onClick={() => openBuilder(r)}
                              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                            >
                              {r.title}
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 shrink-0"
                                  aria-label="Report actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => openBuilder(r)}>
                                  <Pencil className="mr-2 h-4 w-4" /> Open builder
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => copyLink(r.share_token)}
                                  disabled={!!r.revoked_at}
                                >
                                  <Copy className="mr-2 h-4 w-4" /> Copy link
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!!r.revoked_at}
                                  onClick={() =>
                                    window.open(
                                      shareUrl(r.share_token),
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" /> Open
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!!r.revoked_at}
                                  onClick={() =>
                                    window.open(
                                      sitepixApi.urls.reportPdf(r.share_token),
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-4 w-4" /> Download PDF
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => toggleRevoke(r)}>
                                  {r.revoked_at ? (
                                    <>
                                      <Eye className="mr-2 h-4 w-4" /> Re-enable link
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="mr-2 h-4 w-4" /> Disable link
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDelete(r)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {r.summary && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {r.summary}
                            </p>
                          )}

                          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{new Date(r.created_at).toLocaleDateString()}</span>
                            {previewIds.length > 0 && (
                              <div className="flex -space-x-1.5">
                                {previewIds.map((id) => {
                                  const p = photoMap.get(id);
                                  return (
                                    <div
                                      key={id}
                                      className="h-6 w-6 overflow-hidden rounded-full border-2 border-background bg-muted"
                                    >
                                      {p?.url ? (
                                        <img
                                          src={p.url}
                                          alt=""
                                          className="h-full w-full object-cover"
                                          loading="lazy"
                                        />
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="checklists" className="mt-0">
          <section>
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">Completed checklists</h2>
                {completedChecklists.length > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {completedChecklists.length}
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Snapshots of checklists your team has completed on this project.
              </p>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : completedChecklists.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="No completed checklists yet"
                description="Complete a checklist from the Checklists tab and it will show up here."
              />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {completedChecklists.map((c) => {
                  const items = Array.isArray(c.snapshot?.items) ? c.snapshot.items : [];
                  const done = items.filter((it: any) => it.completed_at).length;
                  return (
                    <li key={c.id}>
                      <Card className="flex h-full flex-col p-4">
                        <div className="flex items-start gap-2">
                          <ListChecks className="mt-0.5 h-4 w-4 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{c.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Completed {new Date(c.completed_at).toLocaleDateString()} · {done}/
                              {items.length} items
                            </p>
                          </div>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="sitelogs" className="mt-0">
          <ProjectSiteLogs projectId={projectId} projectName={projectName} />
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>Create report</DialogTitle>
            <DialogDescription>
              Set up the basics. You can refine everything in the builder.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="rep-title" className="text-xs uppercase text-muted-foreground">
                Report title
              </Label>
              <Input
                id="rep-title"
                className="mt-1"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
              />
            </div>

            <div>
              <Label className="text-xs uppercase text-muted-foreground">Photos per PDF page</Label>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {([1, 2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraftPhotosPerPage(n)}
                    className={`rounded-md border px-2 py-3 text-sm font-medium transition ${
                      draftPhotosPerPage === n
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {draftPhotosPerPage <= 2
                  ? "Captions appear beside each photo."
                  : "Captions appear below each photo."}
              </p>
            </div>

            <div className="rounded-md border border-dashed border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={draftCoverEnabled}
                  onCheckedChange={(v) => setDraftCoverEnabled(v === true)}
                />
                Include cover page
              </label>
              {draftCoverEnabled && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draftShowProject}
                      onCheckedChange={(v) => setDraftShowProject(v === true)}
                    />{" "}
                    Project name
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draftShowAddress}
                      onCheckedChange={(v) => setDraftShowAddress(v === true)}
                    />{" "}
                    Address
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draftShowDate}
                      onCheckedChange={(v) => setDraftShowDate(v === true)}
                    />{" "}
                    Date
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draftShowAuthor}
                      onCheckedChange={(v) => setDraftShowAuthor(v === true)}
                    />{" "}
                    Author
                  </label>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={creating || !draftTitle.trim()}>
              {creating ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              Create & open builder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplyTemplateDialog
        open={applyOpen}
        onOpenChange={setApplyOpen}
        projectId={projectId}
        projectName={projectName}
        onApplied={() => {
          void load();
        }}
      />
    </div>
  );
}
