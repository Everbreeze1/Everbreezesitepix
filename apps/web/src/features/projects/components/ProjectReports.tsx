import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Plus, Sparkles, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { relativeTime } from "@everlumen/shared";
import { BlueprintItemBadge } from "./BlueprintItemBadge";
import type { ItemOrigin } from "@/hooks/use-project-blueprint-origin";
import { GenerateDocumentMenu } from "@/features/projects/components/GenerateDocumentMenu";
import type { DocumentTreePage } from "@/lib/project-pages.functions";

/**
 * No walkthrough type here any more, and no summary rows.
 *
 * "The same AI Summary entries currently show up identically in both tabs."
 * They did, because a summary was a walkthrough row and this tab listed
 * walkthrough rows. Summaries are their own object now and they live under
 * Walkthroughs, in its Summaries section - one artefact, one home.
 *
 * What is left in this tab is pages: the generated Reports and anything a
 * document template filed here.
 */

/**
 * "a reports tab for each project that lists the walkthrough Summeries, Daily
 * Log and any reports that have been generated for that project."
 *
 * That was the original brief, and it has since narrowed to the two artefacts a
 * user hands to somebody else: the AI Summary and the Report. The Daily Log
 * left, because it is written for the technician rather than for a client - it
 * is generated automatically at the end of a capture session and surfaced in
 * the Capture flow, which is where it is read. Putting it here meant a trip to
 * Reports to press a button for a document that should never have needed
 * asking for.
 *
 * Deliberately not a copy of ProjectDocuments. Documents is a file manager -
 * folders, drag to move, upload, rename, multi-select. A report is finished
 * output you open, send, or regenerate; it is never filed into a folder,
 * because the whole point of this tab is that reports stopped being filed
 * among the paperwork. A flat list newest-first is the whole interaction.
 */
export function ProjectReports({
  projectId,
  pages,
  loading,
  onChanged,
  originOf,
}: {
  projectId: string;
  /** Pages the server classified into the report bucket - see page-filing.ts. */
  pages: DocumentTreePage[];
  loading?: boolean;
  onChanged?: () => void;
  /** Recorded blueprint origin for one row, by its own id. */
  originOf?: (itemId: string, sourceTemplateId?: string | null) => ItemOrigin;
}) {
  const rows = useMemo(
    () =>
      pages
        .map((p) => ({
          key: `p-${p.id}`,
          originId: p.id,
          title: p.title,
          at: p.updatedAt,
          to: "/projects/$projectId/pages/$pageId",
          params: { projectId, pageId: p.id } as Record<string, string>,
        }))
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    [pages, projectId],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight">Reports</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Generated reports for this job. AI Summaries live with their walkthrough, under{" "}
            <span className="font-bold">Walkthroughs</span>; daily logs are internal and live in the
            Capture flow; stored paperwork lives under Documents.
          </p>
        </div>
        {/* The tab's own create button, offering only what this tab holds. */}
        <GenerateDocumentMenu
          projectId={projectId}
          scope="reports"
          onCreated={onChanged}
          trigger={
            <Button size="sm" className="rounded-lg">
              <Plus className="mr-1.5 h-4 w-4" />
              New report
            </Button>
          }
        />
      </div>

      {/*
        No filter chips.

        There was one kind of row to narrow to and one to narrow away, and now
        there is only one kind: a Report. A single chip reading "Reports 3" over
        a list of three reports is furniture.
      */}

      {loading && rows.length === 0 ? (
        <div className={cn(SURFACE_CARD, "p-10 text-center text-sm text-muted-foreground")}>
          Loading reports…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No reports yet"
          description="Generated reports for this job will appear here, instead of being filed in among the paperwork."
          action={
            <GenerateDocumentMenu
              projectId={projectId}
              scope="reports"
              onCreated={onChanged}
              trigger={
                <Button>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Generate a report
                </Button>
              }
            />
          }
        />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            return (
              <li key={r.key}>
                <Link
                  to={r.to}
                  params={r.params as never}
                  className={cn(
                    SURFACE_CARD,
                    "flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:border-primary/30",
                  )}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <ClipboardList className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{r.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      Report · {relativeTime(r.at)}
                    </span>
                  </span>
                  {/* Which blueprint put this report here, if any. Working that
                      out used to mean cross-checking the blueprint panel
                      against this tab by hand. */}
                  {r.originId && (
                    <span className="shrink-0">
                      <BlueprintItemBadge origin={originOf?.(r.originId)} />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
