import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Footprints, Plus, Sparkles, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { relativeTime } from "@sitepix/shared";
import { BlueprintItemBadge } from "./BlueprintItemBadge";
import type { ItemOrigin } from "@/hooks/use-project-blueprint-origin";
import { GenerateDocumentMenu } from "@/features/projects/components/GenerateDocumentMenu";
import type { DocumentTreePage } from "@/lib/project-pages.functions";

/**
 * The walkthrough fields this list needs, matching the shape ProjectDetailPage
 * already holds. Declared structurally rather than imported so the two do not
 * have to agree on a nominal type that neither of them owns.
 */
export interface ReportWalkthrough {
  id: string;
  title: string;
  created_at: string;
  status: string;
  /** 'recorded' | 'summary'. */
  source: string;
  summary_markdown: string | null;
}

/**
 * "a reports tab for each project that lists the walkthrough Summeries, Daily
 * Log and any reports that have been generated for that project."
 *
 * Three things the client named, from two tables, in one list. They are not
 * merged into a common row type first: a summary links to the walkthrough that
 * produced it and a page links to the page editor, so the only thing they
 * genuinely share is a title, a time and a kind. That is what this row is.
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
  walkthroughs,
  loading,
  onChanged,
  originOf,
}: {
  projectId: string;
  /** Pages the server classified into the report bucket - see page-filing.ts. */
  pages: DocumentTreePage[];
  walkthroughs: ReportWalkthrough[];
  loading?: boolean;
  onChanged?: () => void;
  /**
   * Recorded blueprint origin for one row, by its own id.
   *
   * Only pages can answer. A walkthrough summary is produced from photos and is
   * never something a blueprint creates, so those rows pass no id and stay
   * unbadged rather than being labelled "Added manually" for a question that was
   * never asked of them.
   */
  originOf?: (itemId: string, sourceTemplateId?: string | null) => ItemOrigin;
}) {
  const [kind, setKind] = useState<"all" | "summary" | "daily_log" | "report">("all");

  /**
   * A walkthrough earns a place here once it has a summary to show.
   *
   * Both sources qualify: a recorded walk and a photo summary both end up as
   * `summary_markdown`, and to the person looking for "the summary for this
   * job" the difference is how it was captured, not what it is. One without a
   * summary yet is still processing and would be a row that opens onto
   * nothing.
   */
  const summaries = useMemo(
    () =>
      walkthroughs.filter((w) => w.status === "ready" && (w.summary_markdown ?? "").trim() !== ""),
    [walkthroughs],
  );

  const rows = useMemo(() => {
    const out: Array<{
      key: string;
      title: string;
      at: string;
      kind: "summary" | "daily_log" | "report";
      to: string;
      params: Record<string, string>;
      /** The row's own id where one exists, for the blueprint origin lookup. */
      originId: string | null;
    }> = [];

    for (const w of summaries) {
      out.push({
        key: `w-${w.id}`,
        // Summaries come from photos, never from a blueprint: nothing to
        // attribute, so no badge is drawn at all.
        originId: null,
        title: w.title,
        at: w.created_at,
        kind: "summary",
        to: "/walkthroughs/$walkthroughId",
        params: { walkthroughId: w.id },
      });
    }
    for (const p of pages) {
      out.push({
        key: `p-${p.id}`,
        originId: p.id,
        title: p.title,
        at: p.updatedAt,
        /*
         * Daily Log and Report are both report-bucket pages and the bucket
         * alone cannot tell them apart, so the title carries it. That is thin,
         * but the alternative is shipping `source_template` to the browser
         * purely to letter a badge - and the generator names these pages
         * itself, so the string is not user-entered guesswork.
         */
        kind: /daily log/i.test(p.title) ? "daily_log" : "report",
        to: "/projects/$projectId/pages/$pageId",
        params: { projectId, pageId: p.id },
      });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [pages, summaries, projectId]);

  const visible = kind === "all" ? rows : rows.filter((r) => r.kind === kind);

  const counts = {
    all: rows.length,
    summary: rows.filter((r) => r.kind === "summary").length,
    daily_log: rows.filter((r) => r.kind === "daily_log").length,
    report: rows.filter((r) => r.kind === "report").length,
  };

  /* `plural` is spelt out rather than label + "s", which produced "Summarys". */
  const META = {
    summary: {
      label: "Summary",
      plural: "Summaries",
      icon: Footprints,
      tint: "bg-primary/10 text-primary",
    },
    daily_log: {
      label: "Daily Log",
      plural: "Daily Logs",
      icon: Sparkles,
      tint: "bg-amber-500/10 text-amber-600",
    },
    report: {
      label: "Report",
      plural: "Reports",
      icon: ClipboardList,
      tint: "bg-emerald-500/10 text-emerald-600",
    },
  } as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold tracking-tight">Reports</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Walkthrough summaries, daily logs and generated reports for this job. Stored paperwork
            lives under Documents.
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

      {/* Filter chips. Hidden when there is nothing to narrow. */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "summary", "daily_log", "report"] as const).map((k) => {
            const label = k === "all" ? "All" : META[k].plural;
            const n = counts[k];
            if (k !== "all" && n === 0) return null;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-bold transition-colors",
                  kind === k
                    ? "border-primary/30 bg-primary/[0.07] text-foreground"
                    : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                <span className="tabular-nums text-muted-foreground">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className={cn(SURFACE_CARD, "p-10 text-center text-sm text-muted-foreground")}>
          Loading reports…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="No reports yet"
          description="Walkthrough summaries, daily logs and generated reports for this job will appear here, instead of being filed in among the paperwork."
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
      ) : visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-xs text-muted-foreground">
          No {kind === "all" ? "reports" : META[kind].plural.toLowerCase()} for this job yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((r) => {
            const meta = META[r.kind];
            const Icon = meta.icon;
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
                  <span
                    className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", meta.tint)}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{r.title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {meta.label} · {relativeTime(r.at)}
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
