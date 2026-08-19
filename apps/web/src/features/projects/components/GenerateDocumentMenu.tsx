import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FileText, ClipboardList, Sparkles, Layers, Footprints, Lock } from "lucide-react";
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
import { createProjectPage, generateProjectPage } from "@/lib/project-pages.functions";
import { generateWalkthroughSummary } from "@/lib/walkthroughs.functions";
import { SelectPhotosForPageDialog } from "@/features/projects/components/SelectPhotosForPageDialog";
import { ChoosePageTemplateDialog } from "@/features/projects/components/ChoosePageTemplateDialog";
import { UseTemplateDialog } from "@/features/projects/components/UseTemplateDialog";
import { PhotosPerPagePicker } from "@/features/projects/components/PhotosPerPagePicker";
import { clampPhotosPerPage, useProfile } from "@/hooks/use-profile";
import { useTemplateGate } from "@/features/projects/components/use-template-gate";

/**
 * Summary is deliberately absent: it is not a document. It writes a
 * walkthroughs row and is tracked by its own state below.
 */
type AiTemplate = "daily_log" | "report";

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
      sessionStorage.setItem(`sitepix:freshPage:${res.page.id}`, "1");
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
          ...(aiTemplate === "report" ? { photosPerPage } : {}),
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
      const res = await generateWalkthroughSummary({ data: { projectId, photoIds } });
      if (res.aiFailed) toast.warning("Saved without AI text", { description: res.aiFailed });
      else toast.success("Summary saved under Walkthroughs");
      setSummaryPickerOpen(false);
      onCreated?.();
      navigate({
        to: "/walkthroughs/$walkthroughId",
        params: { walkthroughId: res.walkthroughId },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not generate summary");
    } finally {
      setGeneratingSummary(false);
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
                Saved under Walkthroughs, and listed in Reports
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setSummaryPickerOpen(true)}>
                <Footprints className="mr-2 h-4 w-4 text-primary" />
                <span>
                  <span className="block font-bold">Summary</span>
                  <span className="block text-xs text-muted-foreground">
                    Short shareable brief from your photos
                  </span>
                </span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Saved under Reports
              </DropdownMenuLabel>
              {/* Label stays "Daily Log": the project already has a separate
              "Site Logs" feature (project_site_logs), so reusing that name
              here would point at the wrong thing. */}
              <DropdownMenuItem onClick={() => setAiTemplate("daily_log")}>
                <Sparkles className="mr-2 h-4 w-4 text-primary" />
                <span>
                  <span className="block font-bold">Daily Log</span>
                  <span className="block text-xs text-muted-foreground">
                    Quick internal bullets for your own record
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
                  <span className="block font-bold">Report</span>
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
        templateLabel={aiTemplate === "daily_log" ? "Daily Log" : "Report"}
        generating={generating}
        initialSelected={photoIds}
        options={
          aiTemplate === "report" ? (
            <>
              {/*
                Same wording, same arithmetic and same 2x2-at-four-up layout as
                the editor's Insert > "Section with photos" menu, which has said
                "N photos per page" since long before this control existed. The
                two produce byte-similar markup now (@sitepix/shared's
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
          ) : undefined
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
