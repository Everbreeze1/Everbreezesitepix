import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  ImageOff,
  ChevronUp,
  ChevronDown,
  Check,
  Eye,
  Pencil,
  Copy,
  ExternalLink,
  Download,
  GripVertical,
  X,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { sitepixApi } from "@/lib/sitepix-api";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ReportDocument, type ReportDocModel } from "@/components/ReportDocument";
import { PhotosPerPagePicker } from "@/features/projects/components/PhotosPerPagePicker";
import { ReviewAskStatus } from "@/features/projects/components/ReviewAskStatus";
import { sanitizeCaption } from "@sitepix/shared";

// ---------- types ----------
interface ReportRow {
  id: string;
  project_id: string;
  created_by: string;
  title: string;
  summary: string | null;
  subtitle: string | null;
  photo_ids: string[];
  include_project_info: boolean;
  share_token: string;
  allow_download: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  cover_enabled?: boolean;
  cover_show_project_name?: boolean;
  cover_show_address?: boolean;
  cover_show_date?: boolean;
  cover_show_author?: boolean;
  photos_per_page?: number;
  cover_photo_ids?: string[];
}
interface SectionPhoto {
  photo_id: string;
  caption: string;
}
interface SectionRow {
  id: string;
  report_id: string;
  position: number;
  title: string;
  body: string | null;
  photos: SectionPhoto[];
}
interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}
interface PhotoRef {
  id: string;
  url: string;
  caption: string | null;
  taken_at: string | null;
  tags: string[];
  phase: string | null;
}

// ---------- page ----------
export function ReportBuilderPage() {
  const { projectId, reportId } = useParams({
    from: "/_app/projects/$projectId_/reports/$reportId",
  });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const confirm = useConfirm();
  void user;

  const [report, setReport] = useState<ReportRow | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState<
    { kind: "cover" } | { kind: "section"; sectionId: string } | null
  >(null);
  const [savingFlash, setSavingFlash] = useState<"idle" | "saving" | "saved">("idle");

  const photoMap = useMemo(() => {
    const m = new Map<string, PhotoRef>();
    photos.forEach((p) => m.set(p.id, p));
    return m;
  }, [photos]);

  // A small distance threshold so a click on the handle is not read as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // ----- initial load -----
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [rep, proj, secs, ph] = await Promise.all([
        (supabase as any).from("project_reports").select("*").eq("id", reportId).maybeSingle(),
        supabase
          .from("projects")
          .select("id, name, description, street, city, state, zip")
          .eq("id", projectId)
          .maybeSingle(),
        (supabase as any)
          .from("project_report_sections")
          .select("*")
          .eq("report_id", reportId)
          .order("position", { ascending: true }),
        loadProjectPhotos(projectId),
      ]);
      if (cancel) return;
      if (!rep.data) {
        toast.error("Report not found");
        navigate({
          to: "/projects/$projectId",
          params: { projectId },
          search: { panel: "reports" },
        });
        return;
      }
      setReport(rep.data as ReportRow);
      setProject((proj.data as ProjectRow) ?? null);
      const rawSecs = ((secs.data as SectionRow[]) ?? []).map((s: any) => ({
        ...s,
        photos: (s.photos ?? []).map((p: any) => ({ ...p, caption: sanitizeCaption(p?.caption) })),
      }));
      setSections(rawSecs);
      setPhotos(ph);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [reportId, projectId, navigate]);

  /*
   * Autosave for this screen coalesces pending patches instead of replacing
   * them. Both timers below used to close over a single `patch` object, so
   * re-arming inside the debounce window discarded the earlier patch outright:
   * choose cover photos, type one character within 600ms, and the cover write
   * was cancelled and never re-issued - local state kept showing the covers
   * that the database, and therefore the exported and shared PDF, never got.
   * It is invisible when testing one field at a time, because each keystroke in
   * a single input carries that whole field's current value.
   *
   * `components/builder/use-autosave.ts` merges the same way for the screens
   * that use it; this file predates it and hand-rolls the debounce.
   */

  // ----- autosave: report meta -----
  const reportSaveTimer = useRef<number | null>(null);
  const reportPending = useRef<Partial<ReportRow>>({});
  function patchReport(patch: Partial<ReportRow>) {
    setReport((r) => (r ? { ...r, ...patch } : r));
    reportPending.current = { ...reportPending.current, ...patch };
    if (reportSaveTimer.current) window.clearTimeout(reportSaveTimer.current);
    reportSaveTimer.current = window.setTimeout(async () => {
      const payload = reportPending.current;
      reportPending.current = {};
      if (!Object.keys(payload).length) return;
      setSavingFlash("saving");
      const { error } = await (supabase as any)
        .from("project_reports")
        .update(payload)
        .eq("id", reportId);
      if (error) {
        // Put the fields back so the next edit retries them rather than
        // dropping them. Anything queued since wins the merge.
        reportPending.current = { ...payload, ...reportPending.current };
        toast.error("Save failed", { description: error.message });
        setSavingFlash("idle");
        return;
      }
      flashSaved();
    }, 600);
  }

  // ----- autosave: section -----
  const sectionTimers = useRef<Map<string, number>>(new Map());
  const sectionPending = useRef<Map<string, Partial<SectionRow>>>(new Map());
  function patchSection(id: string, patch: Partial<SectionRow>) {
    setSections((rows) => rows.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    sectionPending.current.set(id, { ...(sectionPending.current.get(id) ?? {}), ...patch });
    const existing = sectionTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(async () => {
      const payload = sectionPending.current.get(id) ?? {};
      sectionPending.current.delete(id);
      if (!Object.keys(payload).length) return;
      setSavingFlash("saving");
      const { error } = await (supabase as any)
        .from("project_report_sections")
        .update(payload)
        .eq("id", id);
      if (error) {
        sectionPending.current.set(id, { ...payload, ...(sectionPending.current.get(id) ?? {}) });
        toast.error("Section save failed", { description: error.message });
        setSavingFlash("idle");
        return;
      }
      flashSaved();
    }, 600);
    sectionTimers.current.set(id, t);
  }

  /*
   * Flush whatever is still debounced when the editor unmounts. Navigating away
   * inside the 600ms window otherwise dropped the last edit with no signal -
   * the timers were never cleared either, so they also fired into a dead
   * component. Fire-and-forget is deliberate: unmount can't await, and a
   * best-effort write beats a guaranteed loss.
   */
  useEffect(() => {
    return () => {
      if (reportSaveTimer.current) window.clearTimeout(reportSaveTimer.current);
      const pendingReport = reportPending.current;
      reportPending.current = {};
      if (Object.keys(pendingReport).length)
        void (supabase as any).from("project_reports").update(pendingReport).eq("id", reportId);
      for (const t of sectionTimers.current.values()) window.clearTimeout(t);
      const pendingSections = new Map(sectionPending.current);
      sectionPending.current.clear();
      for (const [sid, payload] of pendingSections) {
        if (Object.keys(payload).length)
          void (supabase as any).from("project_report_sections").update(payload).eq("id", sid);
      }
    };
  }, [reportId]);
  function flashSaved() {
    setSavingFlash("saved");
    window.setTimeout(() => setSavingFlash("idle"), 1200);
  }

  // ----- section ops -----
  async function addSection() {
    // max+1, not `.length` - `deleteSection` doesn't renumber survivors, so
    // length reused a position an existing section still held and the two then
    // sorted arbitrarily in the builder and in the exported report.
    const position = sections.reduce((max, s) => Math.max(max, s.position), -1) + 1;
    const { data, error } = await (supabase as any)
      .from("project_report_sections")
      .insert({ report_id: reportId, position, title: "New section", body: "", photos: [] })
      .select("*")
      .single();
    if (error || !data) {
      toast.error("Couldn't add section", { description: error?.message });
      return;
    }
    setSections((rs) => [...rs, data as SectionRow]);
  }
  async function deleteSection(id: string) {
    if (!(await confirm({ description: "Delete this section?", variant: "destructive" }))) return;
    const prev = sections;
    setSections((rs) => rs.filter((s) => s.id !== id));
    const { error } = await (supabase as any).from("project_report_sections").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't delete");
      setSections(prev);
    }
  }
  async function moveSection(id: string, dir: -1 | 1) {
    const idx = sections.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[idx], next[j]] = [next[j], next[idx]];
    await persistSectionOrder(next);
  }

  /**
   * Drop handler for dragging a section.
   *
   * The card has always shown a grip handle, but nothing was wired to it - no
   * DndContext, no listeners - so grabbing it did nothing and the only way to
   * reorder was the chevrons in the opposite corner of the card. Both paths now
   * end in `persistSectionOrder`, so they cannot drift.
   */
  async function onSectionDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = sections.findIndex((s) => s.id === active.id);
    const to = sections.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    await persistSectionOrder(arrayMove(sections, from, to));
  }

  /** Renumber from zero and write every position, with rollback on failure. */
  async function persistSectionOrder(next: SectionRow[]) {
    const renumbered = next.map((s, i) => ({ ...s, position: i }));
    const prev = sections;
    setSections(renumbered);
    const results = await Promise.all(
      renumbered.map((s) =>
        (supabase as any)
          .from("project_report_sections")
          .update({ position: s.position })
          .eq("id", s.id),
      ),
    );
    // The export is rendered from the database, not from this screen - so an
    // unreported failure here shipped the customer a report whose sections are
    // in a different order than the author was looking at. Both sibling writes
    // in this file (`patchReport`, `patchSection`) already check; this didn't.
    if (results.some((r: any) => r?.error)) {
      toast.error("Couldn't save section order");
      /*
       * Restore the previous ORDER only, keyed by id and computed inside the
       * updater. Replaying the whole `prev` snapshot would also revert any
       * title or body edit made during the round trip - and `patchSection`
       * has already queued that edit for the database on its own debounce, so
       * the text would disappear from the editor and still be saved, leaving
       * the screen and the exported report disagreeing.
       */
      const before = new Map(prev.map((s, i) => [s.id, { i, position: s.position }]));
      setSections((rows) =>
        [...rows]
          .sort((a, b) => (before.get(a.id)?.i ?? 0) - (before.get(b.id)?.i ?? 0))
          .map((s) => ({ ...s, position: before.get(s.id)?.position ?? s.position })),
      );
      return;
    }
    flashSaved();
  }
  function addPhotosToSection(sectionId: string, ids: string[]) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;
    const existing = new Set(sec.photos.map((p) => p.photo_id));
    const merged = [
      ...sec.photos,
      ...ids.filter((id) => !existing.has(id)).map((id) => ({ photo_id: id, caption: "" })),
    ];
    patchSection(sectionId, { photos: merged });
  }
  function removePhoto(sectionId: string, photoId: string) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;
    const removed = sec.photos.find((p) => p.photo_id === photoId);
    patchSection(sectionId, { photos: sec.photos.filter((p) => p.photo_id !== photoId) });
    /*
     * Offer the caption back. Removing a photo used to silently destroy whatever
     * had been typed about it, and re-adding it returns an empty caption - so a
     * misclick cost real writing with no way back. The undo restores the entry
     * at its original index, because photo order decides which photos share a
     * page in the export.
     */
    const index = sec.photos.findIndex((p) => p.photo_id === photoId);
    toast("Photo removed", {
      description: removed?.caption ? "Its caption was removed too." : undefined,
      action: {
        label: "Undo",
        onClick: () => {
          const now = sections.find((s) => s.id === sectionId);
          if (!now || !removed) return;
          if (now.photos.some((p) => p.photo_id === photoId)) return;
          const next = [...now.photos];
          next.splice(Math.min(index, next.length), 0, removed);
          patchSection(sectionId, { photos: next });
        },
      },
    });
  }

  /**
   * Reorder photos inside a section.
   *
   * Order is load-bearing, not cosmetic: every renderer consumes `photos`
   * positionally and batches them `photosPerPage` at a time, so the sequence
   * decides which photos share a page. Until now the only way to move photo 5
   * ahead of photo 2 was to remove everything after it and re-add it - which
   * also discarded the captions.
   */
  function movePhoto(sectionId: string, from: number, to: number) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;
    if (from === to || from < 0 || to < 0 || from >= sec.photos.length || to >= sec.photos.length)
      return;
    const next = [...sec.photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    patchSection(sectionId, { photos: next });
  }
  function setPhotoCaption(sectionId: string, photoId: string, caption: string) {
    const sec = sections.find((s) => s.id === sectionId);
    if (!sec) return;
    patchSection(sectionId, {
      photos: sec.photos.map((p) => (p.photo_id === photoId ? { ...p, caption } : p)),
    });
  }

  // ----- cover photo ops -----
  function addCoverPhotos(ids: string[]) {
    if (!report) return;
    const existing = new Set(report.cover_photo_ids ?? []);
    const merged = [...(report.cover_photo_ids ?? []), ...ids.filter((id) => !existing.has(id))];
    patchReport({ cover_photo_ids: merged });
  }
  function removeCoverPhoto(id: string) {
    if (!report) return;
    patchReport({ cover_photo_ids: (report.cover_photo_ids ?? []).filter((x) => x !== id) });
  }

  // ----- share / pdf -----
  const shareUrl = useMemo(() => {
    if (!report || typeof window === "undefined") return "";
    return `${window.location.origin}/share/reports/${report.share_token}`;
  }, [report]);
  async function copyShareLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  // ----- preview model -----
  const previewDoc: ReportDocModel | null = useMemo(() => {
    if (!report) return null;
    return {
      title: report.title,
      summary: report.summary,
      subtitle: report.subtitle ?? null,
      createdAt: report.created_at,
      photosPerPage: Math.min(4, Math.max(1, report.photos_per_page ?? 2)) as 1 | 2 | 3 | 4,
      cover: {
        enabled: report.cover_enabled ?? true,
        showProjectName: report.cover_show_project_name ?? true,
        showAddress: report.cover_show_address ?? true,
        showDate: report.cover_show_date ?? true,
        showAuthor: report.cover_show_author ?? true,
        photos: (report.cover_photo_ids ?? []).map((id) => {
          const p = photoMap.get(id);
          return { photo_id: id, image_url: p?.url ?? "", caption: p?.caption ?? "" };
        }),
      },
      project: project
        ? {
            name: project.name,
            street: project.street,
            city: project.city,
            state: project.state,
            zip: project.zip,
          }
        : null,
      company: profile
        ? {
            name: (profile as any).company ?? null,
            logo_url: (profile as any).company_logo_url ?? null,
            phone: (profile as any).company_phone ?? null,
            address: (profile as any).company_address ?? null,
          }
        : null,
      authorName: profile?.full_name ?? null,
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        photos: s.photos.map((p) => ({
          photo_id: p.photo_id,
          image_url: photoMap.get(p.photo_id)?.url ?? "",
          caption: p.caption,
        })),
      })),
    };
  }, [report, project, profile, sections, photoMap]);

  if (loading || !report) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      {/* Top bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/projects/$projectId" params={{ projectId }} search={{ panel: "reports" }}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to project
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {savingFlash === "saving"
              ? "Saving…"
              : savingFlash === "saved"
                ? "Saved"
                : "Auto-save on"}
          </span>
          <Button
            variant={preview ? "default" : "outline"}
            size="sm"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? (
              <>
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </>
            ) : (
              <>
                <Eye className="mr-1 h-4 w-4" /> Preview
              </>
            )}
          </Button>
          <Button asChild size="sm" variant="outline" disabled={!!report.revoked_at}>
            <a
              href={sitepixApi.urls.reportPdf(report.share_token)}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="mr-1 h-4 w-4" /> PDF
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={copyShareLink}
            disabled={!!report.revoked_at}
          >
            <Copy className="mr-1 h-4 w-4" /> Copy link
          </Button>
          <Button asChild size="sm" variant="ghost" disabled={!!report.revoked_at}>
            <a href={shareUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      {/* Under the share row rather than beside it: this is about what the
          customer will see after Copy link is pressed, not another control. */}
      {!report.revoked_at && <ReviewAskStatus />}

      {preview && previewDoc ? (
        <div className="rounded-lg bg-muted/30 p-4 sm:p-8">
          <ReportDocument doc={previewDoc} />
        </div>
      ) : (
        <>
          {/* Title + photos-per-page */}
          <Card className="mb-4 p-4">
            <Label
              htmlFor="rb-title"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Report title
            </Label>
            <Input
              id="rb-title"
              className="mt-1 text-lg font-semibold"
              value={report.title}
              onChange={(e) => patchReport({ title: e.target.value })}
            />

            <div className="mt-4">
              <PhotosPerPagePicker
                value={Math.min(4, Math.max(1, report.photos_per_page ?? 2)) as 1 | 2 | 3 | 4}
                onChange={(n) => patchReport({ photos_per_page: n })}
              />
            </div>
          </Card>

          {/* COVER PAGE SECTION */}
          <Card className="mb-4 overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                  Cover page
                </span>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!report.cover_enabled}
                  onCheckedChange={(v) => patchReport({ cover_enabled: v === true })}
                />
                Enabled
              </label>
            </div>
            {report.cover_enabled && (
              <div className="space-y-4 p-4">
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Show on cover
                  </Label>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <CoverToggle
                      label="Project name"
                      value={!!report.cover_show_project_name}
                      onChange={(v) => patchReport({ cover_show_project_name: v })}
                    />
                    <CoverToggle
                      label="Address"
                      value={!!report.cover_show_address}
                      onChange={(v) => patchReport({ cover_show_address: v })}
                    />
                    <CoverToggle
                      label="Date"
                      value={!!report.cover_show_date}
                      onChange={(v) => patchReport({ cover_show_date: v })}
                    />
                    <CoverToggle
                      label="Author name"
                      value={!!report.cover_show_author}
                      onChange={(v) => patchReport({ cover_show_author: v })}
                    />
                  </div>
                </div>

                <div>
                  <Label
                    htmlFor="rb-subtitle"
                    className="text-xs uppercase tracking-wider text-muted-foreground"
                  >
                    Subtitle (optional)
                  </Label>
                  <Input
                    id="rb-subtitle"
                    className="mt-1"
                    value={report.subtitle ?? ""}
                    onChange={(e) => patchReport({ subtitle: e.target.value })}
                    placeholder="Optional short subtitle shown under the title"
                    maxLength={140}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                      Cover photos
                    </Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPicker({ kind: "cover" })}
                    >
                      <ImageIcon className="mr-1 h-4 w-4" /> Add photos
                    </Button>
                  </div>
                  {(report.cover_photo_ids ?? []).length > 0 ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(report.cover_photo_ids ?? []).map((id) => {
                        const ph = photoMap.get(id);
                        return (
                          <div
                            key={id}
                            className="relative overflow-hidden rounded-md border border-border"
                          >
                            <div className="aspect-[4/3] bg-muted">
                              {ph?.url ? (
                                <img
                                  src={ph.url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                  <ImageOff className="h-6 w-6" />
                                </div>
                              )}
                            </div>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="absolute right-1 top-1 h-6 w-6"
                              onClick={() => removeCoverPhoto(id)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      No cover photos yet. Add up to a few hero shots.
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Sections */}
          <div className="space-y-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onSectionDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {sections.map((s, i) => (
                    <SectionEditor
                      key={s.id}
                      section={s}
                      index={i}
                      total={sections.length}
                      photoMap={photoMap}
                      onChange={(patch) => patchSection(s.id, patch)}
                      onMoveUp={() => moveSection(s.id, -1)}
                      onMoveDown={() => moveSection(s.id, 1)}
                      onDelete={() => deleteSection(s.id)}
                      onAddPhotos={() => setPicker({ kind: "section", sectionId: s.id })}
                      onRemovePhoto={(pid) => removePhoto(s.id, pid)}
                      onSetCaption={(pid, cap) => setPhotoCaption(s.id, pid, cap)}
                      onMovePhoto={(from, to) => movePhoto(s.id, from, to)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <Button onClick={addSection} variant="outline" className="w-full border-dashed">
              <Plus className="mr-1 h-4 w-4" /> Add section
            </Button>
          </div>
        </>
      )}

      {/* Photo picker */}
      {picker && (
        <PhotoPickerDialog
          open={!!picker}
          photos={photos}
          existing={
            picker.kind === "cover"
              ? new Set(report.cover_photo_ids ?? [])
              : new Set(
                  sections.find((s) => s.id === picker.sectionId)?.photos.map((p) => p.photo_id) ??
                    [],
                )
          }
          onClose={() => setPicker(null)}
          onPick={(ids) => {
            if (picker.kind === "cover") addCoverPhotos(ids);
            else addPhotosToSection(picker.sectionId, ids);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- subcomponents ----------
function CoverToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={value} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

interface SectionEditorProps {
  section: SectionRow;
  index: number;
  total: number;
  photoMap: Map<string, PhotoRef>;
  onChange: (patch: Partial<SectionRow>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onAddPhotos: () => void;
  onRemovePhoto: (id: string) => void;
  onSetCaption: (id: string, caption: string) => void;
  onMovePhoto: (from: number, to: number) => void;
}
function SectionEditor(p: SectionEditorProps) {
  // The tile itself is the drag surface, so it needs a slightly longer travel
  // before a drag starts - otherwise tapping the remove button can register as
  // a drag on a touchscreen.
  const photoSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.section.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    // Lift the card over its siblings while dragging; without it the next
    // card's opaque background paints across the one being moved. `position`
    // comes from `relative` below - z-index is inert on a static box, and
    // stays under AppHeader's z-20.
    zIndex: isDragging ? 5 : undefined,
  };
  return (
    <Card ref={setNodeRef} style={style} className="relative p-4">
      <div className="flex items-start gap-2">
        {/*
          A real handle. This was a bare icon with no listeners for as long as
          the screen has existed - it advertised a drag that did nothing, while
          the only working reorder was the chevrons in the opposite corner.
        */}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder section ${p.index + 1}`}
          className="mt-2 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Section title
            </Label>
            <Input
              className="mt-1 font-medium"
              value={p.section.title}
              onChange={(e) => p.onChange({ title: e.target.value })}
              placeholder="e.g. Before Work, Issues Found"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Body</Label>
            <div className="mt-1">
              <RichTextEditor
                value={p.section.body ?? ""}
                onChange={(html) => p.onChange({ body: html })}
                placeholder="Describe what's in this section…"
                minHeight={100}
                pageBreaks
              />
            </div>
            {/*
              The page model was never stated anywhere, which is most of why
              "I should be able to insert a page break - I don't see that
              option" was a fair complaint: sections have always been pages,
              and nothing said so.
            */}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Each section starts a new page. Use the page-break button to split a long section
              across pages.
            </p>
          </div>

          {/* Photos */}
          {p.section.photos.length > 0 && (
            <>
              {/*
                Photo order is load-bearing, not cosmetic: every renderer
                consumes this array positionally and batches it photosPerPage at
                a time, so the sequence decides which photos share a page. Before
                this the only way to move one was to delete everything after it
                and re-add - which also discarded the captions.
              */}
              <p className="text-[11px] text-muted-foreground">
                Drag a photo to reorder. Order decides which photos share a page.
              </p>
              <DndContext
                sensors={photoSensors}
                collisionDetection={closestCenter}
                onDragEnd={(e) => {
                  const { active, over } = e;
                  if (!over || active.id === over.id) return;
                  const from = p.section.photos.findIndex((x) => x.photo_id === active.id);
                  const to = p.section.photos.findIndex((x) => x.photo_id === over.id);
                  if (from >= 0 && to >= 0) p.onMovePhoto(from, to);
                }}
              >
                <SortableContext
                  items={p.section.photos.map((x) => x.photo_id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {p.section.photos.map((sp) => (
                      <SectionPhotoTile
                        key={sp.photo_id}
                        sp={sp}
                        photo={p.photoMap.get(sp.photo_id)}
                        onRemove={() => p.onRemovePhoto(sp.photo_id)}
                        onSetCaption={(cap) => p.onSetCaption(sp.photo_id, cap)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={p.onAddPhotos}>
              <ImageIcon className="mr-1 h-4 w-4" /> Add photos
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon" variant="ghost" disabled={p.index === 0} onClick={p.onMoveUp}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={p.index === p.total - 1}
                onClick={p.onMoveDown}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={p.onDelete} className="text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * One draggable photo in a section.
 *
 * The whole tile is the drag handle rather than a separate grip: the tiles are
 * small, and a grip would compete for space with the remove button and the
 * caption editor. The caption editor and the remove button stop propagation so
 * typing and clicking still work.
 */
function SectionPhotoTile({
  sp,
  photo,
  onRemove,
  onSetCaption,
}: {
  sp: { photo_id: string; caption: string };
  photo: PhotoRef | undefined;
  onRemove: () => void;
  onSetCaption: (caption: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sp.photo_id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 5 : undefined,
      }}
      className="relative overflow-hidden rounded-md border border-border bg-card"
    >
      <div
        {...attributes}
        {...listeners}
        className="relative aspect-[4/3] cursor-grab touch-none bg-muted active:cursor-grabbing"
      >
        {photo?.url ? (
          <img src={photo.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
        <Button
          size="icon"
          variant="secondary"
          className="absolute right-1 top-1 h-7 w-7"
          aria-label="Remove photo"
          // The tile is the drag surface, so the button has to opt out of it or
          // a click reads as the start of a drag.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="border-t" onPointerDown={(e) => e.stopPropagation()}>
        <RichTextEditor
          value={sp.caption}
          onChange={onSetCaption}
          placeholder="Photo caption…"
          minHeight={56}
          compact
          className="rounded-none border-0"
        />
      </div>
    </div>
  );
}

// ---------- photo picker ----------
interface PickerProps {
  open: boolean;
  photos: PhotoRef[];
  existing: Set<string>;
  onClose: () => void;
  onPick: (ids: string[]) => void;
}
function PhotoPickerDialog({ open, photos, existing, onClose, onPick }: PickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => {
    if (open) setSelected(new Set());
  }, [open]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    photos.forEach((p) => p.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [photos]);

  const filtered = useMemo(
    () => (tag ? photos.filter((p) => p.tags.includes(tag)) : photos),
    [photos, tag],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 pb-4 pt-5">
            <DialogTitle>Pick photos</DialogTitle>
            <DialogDescription>
              Choose from this project's photo library. Already-added photos are dimmed.
            </DialogDescription>
          </DialogHeader>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b px-6 py-2">
              <Badge
                variant={tag === null ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setTag(null)}
              >
                All
              </Badge>
              {allTags.map((t) => (
                <Badge
                  key={t}
                  variant={tag === t ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setTag((cur) => (cur === t ? null : t))}
                >
                  {t}
                </Badge>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No photos.</div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {filtered.map((p) => {
                  const checked = selected.has(p.id);
                  const already = existing.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => !already && toggle(p.id)}
                      disabled={already}
                      className={`group relative aspect-square overflow-hidden rounded-md border-2 transition ${
                        checked
                          ? "border-primary ring-2 ring-primary/30"
                          : already
                            ? "border-border opacity-40"
                            : "border-border hover:border-primary/50"
                      }`}
                    >
                      {p.url ? (
                        <img
                          src={p.url}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                          <ImageOff className="h-5 w-5" />
                        </div>
                      )}
                      {checked && (
                        <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      {already && (
                        <div className="absolute inset-x-0 bottom-0 bg-background/80 px-1 py-0.5 text-[10px] text-muted-foreground">
                          Added
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="border-t px-6 py-3">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onPick(Array.from(selected))} disabled={selected.size === 0}>
              <Plus className="mr-1 h-4 w-4" /> Add {selected.size || ""} photo
              {selected.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- data helpers ----------
async function loadProjectPhotos(projectId: string): Promise<PhotoRef[]> {
  const { data } = await supabase
    .from("photos")
    .select("id, storage_path, image_url, caption, taken_at, tags, phase")
    .eq("project_id", projectId)
    // Trashed photos are soft-deleted and nothing enforces the filter at the
    // database level, so every read has to exclude them by hand. Without this
    // a deleted photo stayed selectable here, got written into
    // `project_report_sections.photos`, and was rendered to the customer on
    // /share/reports/$token - until the 60-day purge blanked the slot.
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const rows = (data as any[]) ?? [];
  // One batch signing request rather than one per row. This query has no
  // `.limit()` at all, so on a long-running project the old fan-out issued a
  // signing request for every unsigned photo in the project at once.
  const toSign = rows
    .filter((r) => !r.image_url && r.storage_path)
    .map((r) => r.storage_path as string);
  const signedByPath: Record<string, string> = {};
  if (toSign.length) {
    const { data: signed } = await supabase.storage
      .from("site-photos")
      .createSignedUrls(toSign, 60 * 60);
    signed?.forEach((s, i) => {
      if (s.signedUrl) signedByPath[toSign[i]] = s.signedUrl;
    });
  }
  // Built in query order, so the re-sort the fan-out needed is gone with it.
  return rows.map((r) => ({
    id: r.id,
    url: (r.image_url as string | null) ?? signedByPath[r.storage_path] ?? "",
    caption: sanitizeCaption(r.caption) || null,
    taken_at: r.taken_at ?? null,
    tags: r.tags ?? [],
    phase: r.phase ?? null,
  }));
}
