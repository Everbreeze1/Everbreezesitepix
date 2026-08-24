import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  FileText,
  ClipboardList,
  FileBarChart,
  Loader2,
  Layers,
  Footprints,
  Lock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  createProjectPage,
  generateComprehensiveReport,
  generateProjectPage,
} from "@/lib/project-pages.functions";
import { generateSummaryFromPhotos } from "@/lib/summaries.functions";
import { SelectPhotosForPageDialog } from "@/features/projects/components/SelectPhotosForPageDialog";
import { ChoosePageTemplateDialog } from "@/features/projects/components/ChoosePageTemplateDialog";
import { UseTemplateDialog } from "@/features/projects/components/UseTemplateDialog";
import { PhotosPerPagePicker } from "@/features/projects/components/PhotosPerPagePicker";
import { clampPhotosPerPage, useProfile } from "@/hooks/use-profile";
import { useTemplateGate } from "@/features/projects/components/use-template-gate";

/**
 * What this menu can generate as a project *page*, which is now only the
 * Report.
 *
 * Summary is absent because it is not a document: it writes a walkthroughs row,
 * tracked by its own state below. Daily Log is absent because nobody generates
 * one by hand any more - the capture flow writes it the moment a photo session
 * finishes, and it is read from the Capture flow rather than from here. Leaving
 * a button for it would put the technician's internal record back in the list
 * of things you hand a client.
 */
type AiTemplate = "report";

/**
 * The single place a project artefact gets generated - Summary, Daily Log,
 * Report, a saved template, or a blank page.
 *
 * This used to live only inside the Documents tab's "Create" dropdown, which
 * made generating a summary something you had to navigate *into storage* to
 * find. Documents is where finished work is filed; generating it is a primary
 * project action, so the same menu is now mounted in the project header too.
 * Both entry points share this component so the two can never drift apart.
 *
 * Not everything here lands in Documents. A Summary is the AI's notes on a set
 * of photos - the same object a walkthrough produces, minus the walk - so it is
 * filed under Walkthroughs. The menu says so at the point of click rather than
 * surprising the user with a document that isn't in Documents.
 */
export function GenerateDocumentMenu({
  projectId,
  folderId = null,
  trigger,
  align = "end",
  photoIds,
  onCreated,
  scope = "all",
}: {
  projectId: string;
  /** Documents tab passes the open folder so generated files land there; the header uses the root. */
  folderId?: string | null;
  trigger: ReactNode;
  align?: "start" | "end";
  /**
   * Photos already chosen by the caller - the photo selection bar mounts this
   * menu, and its user has picked their photos before the menu even opens. The
   * picker still appears so they can see and adjust what will be read; it just
   * opens with their selection ticked instead of blank.
   */
  photoIds?: string[];
  onCreated?: () => void;
  /**
   * Which kinds this trigger offers.
   *
   * The project header keeps "all" - from there you have not said what you are
   * making yet. Each tab passes its own, so the button inside Reports makes
   * reports and the one inside Documents makes documents, which is the client's
   * "the Create Document on top should be for creating new report": the button
   * belongs to the list under it rather than being one menu that files things
   * into whichever tab you were not looking at.
   */
  scope?: "all" | "reports" | "documents";
}) {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const { locked: templatesLocked, promptUpgrade } = useTemplateGate();
  const [aiTemplate, setAiTemplate] = useState<AiTemplate | null>(null);
  const [generating, setGenerating] = useState(false);
  /*
   * Report page density. Seeded from the author's saved default each time the
   * picker opens, so a company that always files three-up is not resetting a
   * control on every report - but still changeable for the one document in
   * front of them.
   */
  const [photosPerPage, setPhotosPerPage] = useState<1 | 2 | 3 | 4>(2);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  /** Chosen template, waiting on the fill-in step before anything is created. */
  const [useTemplateId, setUseTemplateId] = useState<string | null>(null);
  const [summaryPickerOpen, setSummaryPickerOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [generatingFull, setGeneratingFull] = useState(false);

  /* Which halves of the menu render. Both are true for "all". */
  const showReportKinds = scope === "all" || scope === "reports";
  const showDocumentKinds = scope === "all" || scope === "documents";

  const openPage = (pageId: string) => {
    onCreated?.();
    navigate({ to: "/projects/$projectId/pages/$pageId", params: { projectId, pageId } });
  };

  async function handleCreateBlank() {
    try {
      const res = await createProjectPage({ data: { projectId, folderId, template: "blank" } });
      sessionStorage.setItem(`everlumen:freshPage:${res.page.id}`, "1");
      openPage(res.page.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create page");
    }
  }

  /** AI templates need photos first, so they open the picker instead of creating immediately. */
  async function handleGenerate(photoIds: string[]) {
    if (!aiTemplate) return;
    setGenerating(true);
    try {
      const res = await generateProjectPage({
        data: {
          projectId,
          folderId,
          template: aiTemplate,
          photoIds,
          photosPerPage,
        },
      });
      if (res.aiFailed) {
        toast.warning("Created without AI text", { description: res.aiFailed });
      } else {
        toast.success("Document generated");
      }
      setAiTemplate(null);
      openPage(res.page.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate document");
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Summary lands in the Walkthroughs tab, so this navigates there rather than
   * to the page editor - `folderId` is meaningless for it.
   */
  async function handleGenerateSummary(photoIds: string[]) {
    setGeneratingSummary(true);
    try {
      const res = await generateSummaryFromPhotos({ data: { projectId, photoIds } });
      if (res.aiFailed) toast.warning("Saved without AI text", { description: res.aiFailed });
      else toast.success("Summary saved under Walkthroughs");
      setSummaryPickerOpen(false);
      onCreated?.();
      // Its own route now: a summary is not a walkthrough, and no longer opens
      // at one's URL under a tab titled "Walkthrough".
      navigate({ to: "/summaries/$summaryId", params: { summaryId: res.summary.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate summary");
    } finally {
      setGeneratingSummary(false);
    }
  }

  /**
   * The whole-job Report.
   *
   * No photo picker, deliberately. The other report asks which photos to draft
   * from; this one covers the job, so asking would only be a chance to leave
   * something out. It reads every photo, its labels and its metadata, plus the
   * client fields on the project.
   */
  async function handleFullReport() {
    setGeneratingFull(true);
    try {
      const res = await generateComprehensiveReport({ data: { projectId } });
      if (res.aiFailed) toast.warning("Created without AI text", { description: res.aiFailed });
      else toast.success(`Report generated from ${res.photoCount} photos`);
      openPage(res.page.id);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate report");
    } finally {
      setGeneratingFull(false);
    }
  }

  /*
   * Hands off to the fill-in step rather than creating the page here. Applying
   * on the click meant the merge fields nothing could resolve landed in the
   * document as raw `{{tokens}}`, to be hunted down in the rich text editor.
   */
  function handleUseTemplate(templateId: string) {
    setTemplatePickerOpen(false);
    setUseTemplateId(templateId);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-72">
          {showReportKinds && (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Saved under Walkthroughs
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setSummaryPickerOpen(true)}>
                <Footprints className="mr-2 h-4 w-4 text-primary" />
                <span>
                  <span className="block font-bold">AI Summary</span>
                  <span className="block text-xs text-muted-foreground">
                    Short shareable brief from photos you already have
                  </span>
                </span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Saved under Reports
              </DropdownMenuLabel>
              {/*
                Two reports, and the difference is what they read rather than
                how they look: this one reads the whole job, the one below reads
                the photos you pick.
              */}
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  void handleFullReport();
                }}
                disabled={generatingFull}
              >
                {generatingFull ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
                ) : (
                  <FileBarChart className="mr-2 h-4 w-4 text-primary" />
                )}
                <span>
                  <span className="block font-bold">Full Project Report</span>
                  <span className="block text-xs text-muted-foreground">
                    Every photo on the job, organised by label, with your client details
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPhotosPerPage(clampPhotosPerPage(profile?.report_photos_per_page));
                  setAiTemplate("report");
                }}
              >
                <ClipboardList className="mr-2 h-4 w-4 text-primary" />
                <span>
                  <span className="block font-bold">Report from selected photos</span>
                  <span className="block text-xs text-muted-foreground">
                    Client-ready: title page, summary, photo sections, conclusion
                  </span>
                </span>
              </DropdownMenuItem>
            </>
          )}

          {showReportKinds && showDocumentKinds && <DropdownMenuSeparator />}
          {showDocumentKinds && (
            <>
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Saved under Documents
              </DropdownMenuLabel>
              {/*
            Badged rather than removed: the padlock is what tells a Starter
            account the library exists. Selecting it opens the upgrade prompt
            instead of the picker.
          */}
              <DropdownMenuItem
                onClick={(e) => {
                  if (!templatesLocked) return setTemplatePickerOpen(true);
                  e.preventDefault();
                  promptUpgrade();
                }}
              >
                {templatesLocked ? (
                  <Lock className="mr-2 h-4 w-4" />
                ) : (
                  <Layers className="mr-2 h-4 w-4" />
                )}
                <span>
                  <span className="flex items-center gap-1.5 font-bold">
                    More Templates
                    {templatesLocked && (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                        Pro
                      </Badge>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Saved by your team or examples
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCreateBlank}>
                <FileText className="mr-2 h-4 w-4" />
                <span>
                  <span className="block font-bold">Blank page</span>
                  <span className="block text-xs text-muted-foreground">Start from scratch</span>
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SelectPhotosForPageDialog
        open={!!aiTemplate}
        projectId={projectId}
        templateLabel="Report"
        generating={generating}
        initialSelected={photoIds}
        options={
          <>
            {/*
                Same wording, same arithmetic and same 2x2-at-four-up layout as
                the editor's Insert > "Section with photos" menu, which has said
                "N photos per page" since long before this control existed. The
                two produce byte-similar markup now (@everlumen/shared's
                photo-row-layout), so a generated document and a hand-built one
                cannot look like different products.
              */}
            <PhotosPerPagePicker
              label="Photos per page"
              hint={false}
              value={photosPerPage}
              onChange={setPhotosPerPage}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {photosPerPage === 1
                ? "One photo per page, each with its own heading and space to write under it."
                : `${photosPerPage} photos across, grouped under one "Photographic record" heading.`}
            </p>
          </>
        }
        onCancel={() => setAiTemplate(null)}
        onGenerate={handleGenerate}
      />

      <SelectPhotosForPageDialog
        open={summaryPickerOpen}
        projectId={projectId}
        templateLabel="Summary"
        outputNoun="summary"
        generating={generatingSummary}
        initialSelected={photoIds}
        onCancel={() => setSummaryPickerOpen(false)}
        onGenerate={handleGenerateSummary}
      />

      <ChoosePageTemplateDialog
        open={templatePickerOpen}
        onOpenChange={setTemplatePickerOpen}
        projectId={projectId}
        onUse={handleUseTemplate}
      />

      <UseTemplateDialog
        templateId={useTemplateId}
        project={{ id: projectId, name: null }}
        folderId={folderId}
        onOpenChange={(o) => !o && setUseTemplateId(null)}
        onCreated={(_projectId, pageId) => {
          setUseTemplateId(null);
          openPage(pageId);
        }}
      />
    </>
  );
}
