import { ArrowLeft, Loader2, Workflow as WorkflowIcon } from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { useSubscription } from "@/hooks/use-subscription";
import { ProjectWorkflows } from "../components/ProjectWorkflows";

/**
 * One workflow run, as a page.
 *
 * The runner was never literally a modal, but it had every other defect of one:
 * it lived in local panel state, so it had no address to send a crew member, the
 * browser Back button walked off the project entirely instead of returning to
 * the grid, and a refresh dropped you back to the list. A checklist got a route
 * in the same pass; a workflow is the same kind of artefact and now reads the
 * same way - print it, share it, link to it.
 *
 * The run itself is still rendered by `ProjectWorkflows` in focus mode rather
 * than by a second implementation here. Everything a workflow does - the
 * optimistic tick, the phase sign-off, reorder-and-renumber, the photo prompt
 * upload with its orphan reclaim - is exactly the logic that rots once it exists
 * twice, and `tests/invariants.test.ts` pins several of those behaviours to that
 * one file by path.
 */
export function WorkflowDocumentPage() {
  const { projectId, workflowId } = useParams({
    from: "/_app/projects/$projectId_/workflows/$workflowId",
  });
  const navigate = useNavigate();
  const { isTeam, loading } = useSubscription();

  const backToPanel = () =>
    void navigate({
      to: "/projects/$projectId",
      params: { projectId },
      search: { panel: "workflows" },
    });

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /*
   * The same gate the panel applies, for the same reason it moved off the tab's
   * click handler: this id comes from the URL, so a bookmark, a shared internal
   * link or a back-nav would otherwise render the whole runner for a Starter
   * user, who then meets the RLS policy as an unexplained failure.
   */
  if (!isTeam) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <EmptyState
          icon={WorkflowIcon}
          title="Workflows are a Team plan feature"
          description="Multi-phase workflows with checklists, photo prompts, and sign-offs per phase are available on the Team plan."
          action={
            <Button variant="outline" onClick={backToPanel}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to this project
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 px-3 pb-10 sm:px-6">
      {/*
        No `blueprintSources`: that lookup only feeds the blueprint badge on the
        collapsed grid cards, and this page renders no cards. Fetching the
        project's blueprint ledger to render nothing would be a query per open.
      */}
      <ProjectWorkflows projectId={projectId} focusWorkflowId={workflowId} />
    </div>
  );
}
