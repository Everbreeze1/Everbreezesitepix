import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText, LayoutTemplate, Loader2, Lock, Plus, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { clampPhotosPerPage, useProfile } from "@/hooks/use-profile";
import { useSubscription } from "@/hooks/use-subscription";
import { toast } from "sonner";
import {
  REPORT_STARTERS,
  getReportStarter,
  parseReportTemplateStructure,
  sanitizeCaption,
  type ReportStarter,
} from "@sitepix/shared";
import { PhotosPerPagePicker } from "@/features/projects/components/PhotosPerPagePicker";
import { useTemplateGate } from "@/features/projects/components/use-template-gate";
import { cn } from "@/lib/utils";

/**
 * What the report is being built from.
 *
 * `starter` is the built-in library in @sitepix/shared; `saved` is a template
 * this team wrote in Settings, which until now could only be reached through a
 * blueprint and so was invisible to anyone actually filing a report.
 */
type Choice = { kind: "blank" } | { kind: "starter"; id: string } | { kind: "saved"; id: string };

interface SavedTemplate {
  id: string;
  name: string;
  subtitle: string | null;
  headings: string[];
  bodies: string[];
}

/** A photo the caller wants filed into the report it is about to create. */
export interface AttachedReportPhoto {
  id: string;
  caption?: string | null;
}

/** Shape of one entry in `project_report_sections.photos`. */
interface SectionPhotoRow {
  photo_id: string;
  caption: string;
}

/** Heading the attached photos are filed under. Renameable in the builder. */
const ATTACHED_SECTION_TITLE = "Photos";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectName: string;
  /**
   * Photos to file into the new report, in order.
   *
   * This is what lets the photo selection bar open the real New Report dialog
   * instead of keeping its own report-creation code path. They land in one
   * section appended after whatever the chosen template contributes; the PDF
   * renderer paginates that section at `photos_per_page`, so there is nothing
   * to chunk here.
   */
  attachPhotos?: AttachedReportPhoto[];
}

/**
 * Create a report, optionally from a template.
 *
 * Templates are Pro and Team. Starter still gets the whole manual builder and
 * every layout control in this dialog - it just starts from a blank structure.
 * The locked cards stay on screen rather than being hidden: a control that
 * disappears reads as a missing feature, and nobody upgrades for something they
 * cannot see.
 */
export function NewReportDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  attachPhotos,
}: Props) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const navigate = useNavigate();
  const { isPro } = useSubscription();
  const { locked: templatesLocked, promptUpgrade } = useTemplateGate();

  const attached = attachPhotos ?? [];

  const [choice, setChoice] = useState<Choice>({ kind: "blank" });
  const [saved, setSaved] = useState<SavedTemplate[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [photosPerPage, setPhotosPerPage] = useState<1 | 2 | 3 | 4>(2);
  const [coverEnabled, setCoverEnabled] = useState(true);
  const [showProject, setShowProject] = useState(true);
  const [showAddress, setShowAddress] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [showAuthor, setShowAuthor] = useState(true);

  // Reset on every open so a cancelled attempt never leaks its title or its
  // template choice into the next report.
  useEffect(() => {
    if (!open) return;
    setChoice({ kind: "blank" });
    setTitle(`${projectName} report - ${new Date().toLocaleDateString()}`);
    setSubtitle("");
    setPhotosPerPage(clampPhotosPerPage(profile?.report_photos_per_page));
    setCoverEnabled(true);
    setShowProject(true);
    setShowAddress(true);
    setShowDate(true);
    setShowAuthor(true);
  }, [open, projectName, profile?.report_photos_per_page]);

  useEffect(() => {
    if (!open || !isPro) return;
    let cancelled = false;
    setLoadingSaved(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("report_templates")
        .select("id, name, subtitle, sections, archived")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      const rows = ((data as any[]) ?? [])
        .filter((r) => !r.archived)
        .map((r) => {
          const parsed = parseReportTemplateStructure(r.sections);
          return {
            id: r.id as string,
            name: (r.name as string) ?? "Untitled template",
            subtitle: (r.subtitle as string | null) ?? null,
            headings: parsed.items.map((i) => i.heading),
            bodies: parsed.items.map((i) => i.body),
          };
        })
        .filter((t) => t.headings.length > 0);
      setSaved(rows);
      setLoadingSaved(false);
    })().catch(() => {
      if (!cancelled) setLoadingSaved(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, isPro]);

  const activeStarter: ReportStarter | null =
    choice.kind === "starter" ? getReportStarter(choice.id) : null;
  const activeSaved = choice.kind === "saved" ? saved.find((t) => t.id === choice.id) : undefined;

  /** Headings the created report will start with, for the confirmation line. */
  const previewHeadings = useMemo(() => {
    const base = activeStarter ? activeStarter.sections : activeSaved ? activeSaved.headings : [];
    return attached.length ? [...base, ATTACHED_SECTION_TITLE] : base;
  }, [activeStarter, activeSaved, attached.length]);

  function pickStarter(t: ReportStarter) {
    if (templatesLocked) {
      promptUpgrade();
      return;
    }
    setChoice({ kind: "starter", id: t.id });
    setPhotosPerPage(t.photosPerPage);
    setCoverEnabled(t.cover.enabled);
    setShowProject(t.cover.showProjectName);
    setShowAddress(t.cover.showAddress);
    setShowDate(t.cover.showDate);
    setShowAuthor(t.cover.showAuthor);
  }

  async function submit() {
    if (!user) return;
    const finalTitle = title.trim() || `${projectName} report`;
    setCreating(true);
    try {
      const { data, error } = await (supabase as any)
        .from("project_reports")
        .insert({
          project_id: projectId,
          created_by: user.id,
          title: finalTitle,
          subtitle: subtitle.trim() || null,
          summary: null,
          photo_ids: [],
          include_project_info: true,
          allow_download: true,
          photos_per_page: photosPerPage,
          cover_enabled: coverEnabled,
          cover_show_project_name: showProject,
          cover_show_address: showAddress,
          cover_show_date: showDate,
          cover_show_author: showAuthor,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Could not create report");
      const reportId = data.id as string;

      const sections: Array<{ title: string; body: string; photos: SectionPhotoRow[] }> = (
        activeStarter
          ? activeStarter.sections.map((heading) => ({ title: heading, body: "" }))
          : activeSaved
            ? activeSaved.headings.map((heading, i) => ({
                title: heading,
                body: activeSaved.bodies[i] ?? "",
              }))
            : []
      ).map((s) => ({ ...s, photos: [] }));

      if (attached.length) {
        sections.push({
          title: ATTACHED_SECTION_TITLE,
          body: "",
          photos: attached.map((p) => ({
            photo_id: p.id,
            caption: sanitizeCaption(p.caption ?? null),
          })),
        });
      }

      if (sections.length) {
        // A failed section insert leaves a usable, empty report rather than
        // nothing at all, so it is reported and stepped over instead of thrown:
        // the user is already on their way to the builder, where they can add
        // the headings by hand.
        const { error: secErr } = await (supabase as any).from("project_report_sections").insert(
          sections.map((s, i) => ({
            report_id: reportId,
            position: i,
            title: s.title,
            body: s.body,
            photos: s.photos,
          })),
        );
        if (secErr)
          toast.warning(
            attached.length
              ? "Report created, but its sections and photos did not save"
              : "Report created, but its sections did not save",
            { description: secErr.message },
          );
      }

      onOpenChange(false);
      navigate({ to: "/projects/$projectId/reports/$reportId", params: { projectId, reportId } });
    } catch (e: any) {
      toast.error("Couldn't create report", { description: e?.message });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle>New report</DialogTitle>
          <DialogDescription>
            {attached.length > 0 && (
              <>
                {attached.length} selected photo{attached.length > 1 ? "s" : ""} will be filed under
                a &quot;{ATTACHED_SECTION_TITLE}&quot; section.{" "}
              </>
            )}
            Pick a structure to start from, then set the page layout. Everything stays editable in
            the builder.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[62vh]">
          <div className="space-y-6 px-6 pb-2">
            {/* ---- start from ---- */}
            <section>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Start from
                </Label>
                {templatesLocked && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Lock className="h-3 w-3" /> Templates on Pro
                  </Badge>
                )}
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StartCard
                  title="Blank report"
                  description="An empty report. Add your own sections as you go."
                  icon={<FileText className="h-4 w-4" />}
                  active={choice.kind === "blank"}
                  onClick={() => setChoice({ kind: "blank" })}
                />
                {REPORT_STARTERS.map((t) => (
                  <StartCard
                    key={t.id}
                    title={t.name}
                    description={t.description}
                    icon={<LayoutTemplate className="h-4 w-4" />}
                    meta={`${t.sections.length} sections · ${t.photosPerPage} per page`}
                    category={t.category}
                    locked={templatesLocked}
                    active={choice.kind === "starter" && choice.id === t.id}
                    onClick={() => pickStarter(t)}
                  />
                ))}
              </div>

              {isPro && (loadingSaved || saved.length > 0) && (
                <div className="mt-4">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Your team's templates
                  </Label>
                  {loadingSaved ? (
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {saved.map((t) => (
                        <StartCard
                          key={t.id}
                          title={t.name}
                          description={t.subtitle || t.headings.join(" · ")}
                          icon={<Sparkles className="h-4 w-4" />}
                          meta={`${t.headings.length} sections`}
                          active={choice.kind === "saved" && choice.id === t.id}
                          onClick={() => {
                            setChoice({ kind: "saved", id: t.id });
                            if (t.subtitle) setSubtitle(t.subtitle);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {previewHeadings.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Sections created: {previewHeadings.join(" · ")}
                </p>
              )}
            </section>

            {/* ---- details ---- */}
            <section className="space-y-4">
              <div>
                <Label
                  htmlFor="nr-title"
                  className="text-xs uppercase tracking-wider text-muted-foreground"
                >
                  Report title
                </Label>
                <Input
                  id="nr-title"
                  className="mt-1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <PhotosPerPagePicker value={photosPerPage} onChange={setPhotosPerPage} />

              <div className="rounded-md border border-dashed border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={coverEnabled}
                    onCheckedChange={(v) => setCoverEnabled(v === true)}
                  />
                  Include cover page
                </label>
                {coverEnabled && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={showProject}
                        onCheckedChange={(v) => setShowProject(v === true)}
                      />{" "}
                      Project name
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={showAddress}
                        onCheckedChange={(v) => setShowAddress(v === true)}
                      />{" "}
                      Address
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={showDate}
                        onCheckedChange={(v) => setShowDate(v === true)}
                      />{" "}
                      Date
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={showAuthor}
                        onCheckedChange={(v) => setShowAuthor(v === true)}
                      />{" "}
                      Author
                    </label>
                  </div>
                )}
              </div>
            </section>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={creating || !title.trim()}>
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Create &amp; open builder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartCard({
  title,
  description,
  icon,
  meta,
  category,
  locked,
  active,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  meta?: string;
  category?: string;
  locked?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition",
        active ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        locked && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{title}</span>
            {locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{description}</p>
          {(meta || category) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {category && (
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {category}
                </Badge>
              )}
              {meta && <span className="text-[10px] text-muted-foreground">{meta}</span>}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
