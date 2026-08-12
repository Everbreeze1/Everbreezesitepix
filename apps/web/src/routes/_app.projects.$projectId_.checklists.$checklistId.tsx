import { createFileRoute } from "@tanstack/react-router";
import { ChecklistDocumentPage } from "@/features/projects/pages/ChecklistDocumentPage";

export const Route = createFileRoute("/_app/projects/$projectId_/checklists/$checklistId")({
  head: () => ({ meta: [{ title: "Checklist — SitePix" }] }),
  /**
   * `new=1` means "this checklist was created a moment ago and still has its
   * placeholder name" — the page selects the title box so naming it is the first
   * thing typed. Carried in the URL rather than inferred from the stored name,
   * so a checklist a user genuinely wants to leave called "Untitled checklist"
   * does not get its title grabbed every time it is opened.
   */
  validateSearch: (search: Record<string, unknown>): { new?: 1 } => ({
    new: search.new === 1 || search.new === "1" ? 1 : undefined,
  }),
  component: ChecklistDocumentPage,
});
