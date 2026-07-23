import { Link, useNavigate, useParams } from "@tanstack/react-router";
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
import { toast } from "sonner";
import { RichTextEditor } from "@/components/RichTextEditor";
import { ReportDocument, type ReportDocModel } from "@/components/ReportDocument";
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
        navigate({ to: "/projects/$projectId", params: { projectId } });
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

  // ----- autosave: report meta -----
  const reportSaveTimer = useRef<number | null>(null);
  function patchReport(patch: Partial<ReportRow>) {
    setReport((r) => (r ? { ...r, ...patch } : r));
    if (reportSaveTimer.current) window.clearTimeout(reportSaveTimer.current);
    reportSaveTimer.current = window.setTimeout(async () => {
      setSavingFlash("saving");
      const { error } = await (supabase as any)
        .from("project_reports")
        .update(patch)
        .eq("id", reportId);
      if (error) toast.error("Save failed", { description: error.message });
      flashSaved();
    }, 600);
  }

  // ----- autosave: section -----
  const sectionTimers = useRef<Map<string, number>>(new Map());
  function patchSection(id: string, patch: Partial<SectionRow>) {
    setSections((rows) => rows.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const existing = sectionTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    const t = window.setTimeout(async () => {
      setSavingFlash("saving");
      const { error } = await (supabase as any)
        .from("project_report_sections")
        .update(patch)
        .eq("id", id);
      if (error) toast.error("Section save failed", { description: error.message });
      flashSaved();
    }, 600);
    sectionTimers.current.set(id, t);
  }
  function flashSaved() {
    setSavingFlash("saved");
    window.setTimeout(() => setSavingFlash("idle"), 1200);
  }

  // ----- section ops -----
  async function addSection() {
    const position = sections.length;
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
    if (!confirm("Delete this section?")) return;
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
    const renumbered = next.map((s, i) => ({ ...s, position: i }));
    setSections(renumbered);
    await Promise.all(
      renumbered.map((s) =>
        (supabase as any)
          .from("project_report_sections")
          .update({ position: s.position })
          .eq("id", s.id),
      ),
    );
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
    patchSection(sectionId, { photos: sec.photos.filter((p) => p.photo_id !== photoId) });
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
          <Link to="/projects/$projectId" params={{ projectId }}>
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
            <a href={sitepixApi.urls.reportPdf(report.share_token)} target="_blank" rel="noreferrer">
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
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Photos per page
              </Label>
              <div className="mt-2 grid max-w-xs grid-cols-4 gap-2">
                {([1, 2, 3, 4] as const).map((n) => {
                  const active = (report.photos_per_page ?? 2) === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => patchReport({ photos_per_page: n })}
                      className={`rounded-md border px-2 py-2 text-sm font-medium transition ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {(report.photos_per_page ?? 2) <= 2
                  ? "Captions render beside each photo."
                  : "Captions render below each photo."}
              </p>
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
              />
            ))}

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
}
function SectionEditor(p: SectionEditorProps) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <GripVertical className="mt-2 h-4 w-4 text-muted-foreground" />
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
              />
            </div>
          </div>

          {/* Photos */}
          {p.section.photos.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {p.section.photos.map((sp) => {
                const ph = p.photoMap.get(sp.photo_id);
                return (
                  <div
                    key={sp.photo_id}
                    className="overflow-hidden rounded-md border border-border"
                  >
                    <div className="relative aspect-[4/3] bg-muted">
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
                      <Button
                        size="icon"
                        variant="secondary"
                        className="absolute right-1 top-1 h-7 w-7"
                        onClick={() => p.onRemovePhoto(sp.photo_id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="border-t">
                      <RichTextEditor
                        value={sp.caption}
                        onChange={(html) => p.onSetCaption(sp.photo_id, html)}
                        placeholder="Photo caption…"
                        minHeight={56}
                        compact
                        className="rounded-none border-0"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
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
    .order("created_at", { ascending: false });
  const rows = (data as any[]) ?? [];
  const out: PhotoRef[] = [];
  await Promise.all(
    rows.map(async (r) => {
      let url = r.image_url as string | null;
      if (!url && r.storage_path) {
        const { data: s } = await supabase.storage
          .from("site-photos")
          .createSignedUrl(r.storage_path, 60 * 60);
        url = s?.signedUrl ?? "";
      }
      out.push({
        id: r.id,
        url: url ?? "",
        caption: sanitizeCaption(r.caption) || null,
        taken_at: r.taken_at ?? null,
        tags: r.tags ?? [],
        phase: r.phase ?? null,
      });
    }),
  );
  const order = new Map(rows.map((r, i) => [r.id, i]));
  out.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return out;
}
