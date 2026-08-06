import { ClipboardList, FileText, Newspaper, Tag, Workflow as WorkflowIcon } from "lucide-react";

export type BlueprintItemKind = "checklist" | "document" | "report" | "label_set" | "workflow";

/**
 * What each blueprint item turns into once it lands on a project.
 *
 * The library screens named the *template* type and stopped there, which is why
 * "I don't know what happens when I select a template" was a fair complaint —
 * nothing told you a workflow becomes a live, phase-by-phase run the crew works
 * through, or that a document becomes a site log with the project's details
 * already filled in.
 *
 * `plural` doubles as the key the apply service reports counts under, so the
 * result screen can map a count back to the thing it describes.
 */
export const KIND_OUTCOME: Record<
  BlueprintItemKind,
  { label: string; plural: string; icon: typeof ClipboardList; tint: string; becomes: string }
> = {
  checklist: {
    label: "Checklist",
    plural: "checklists",
    icon: ClipboardList,
    tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    becomes: "A checklist the crew ticks off under the project's Checklists tab",
  },
  workflow: {
    label: "Workflow",
    plural: "workflows",
    icon: WorkflowIcon,
    tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    becomes: "A live run of phases, photo prompts and sign-off gates on the project",
  },
  document: {
    label: "Document",
    plural: "documents",
    icon: FileText,
    tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    becomes: "A site log with project name, address, date and author already filled in",
  },
  report: {
    label: "Report",
    plural: "reports",
    icon: Newspaper,
    tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    becomes: "A draft report under the project's Documents tab, ready to export",
  },
  label_set: {
    label: "Label set",
    plural: "label sets",
    icon: Tag,
    tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    becomes: "Its labels merged onto the project so it sorts and filters correctly",
  },
};
