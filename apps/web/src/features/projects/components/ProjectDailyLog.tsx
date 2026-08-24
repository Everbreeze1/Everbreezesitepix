import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Loader2, Lock, NotebookPen } from "lucide-react";
import { relativeTime } from "@everlumen/shared";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { DailyLogSummary } from "@/lib/project-pages.functions";

/**
 * The line that must appear wherever a Daily Log does.
 *
 * Mirrors DAILY_LOG_INTERNAL_NOTICE in apps/api/src/domains/projects/page-filing.ts,
 * which is also written into the page body itself so the label survives export
 * to PDF. Duplicated as a constant rather than shipped from the API because it
 * is a piece of UI copy, and a card that could not draw its own label until a
 * network call returned would be a card that renders unlabelled first.
 */
export const DAILY_LOG_INTERNAL_NOTICE = "Internal only - not shared with clients";

/** Bullets shown before the card starts hiding them behind "Open". */
const PREVIEW_ENTRIES = 5;

/** This browser's calendar day for an instant, as `YYYY-MM-DD`. */
function localDay(value: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * "Today" for the log being added to right now, a date for any other.
 *
 * Resolved from the log's own instant in THIS browser's zone rather than from a
 * day string the server computed. The server runs in UTC and cannot know whose
 * midnight matters: it would call a 6:30pm California log "tomorrow", and the
 * card would then print a date for a log written an hour ago.
 */
function dayLabel(createdAt: string): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  if (localDay(created) === localDay(new Date())) return "Today";
  return created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function InternalOnlyBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <Lock className="h-3 w-3" strokeWidth={2.25} />
      {DAILY_LOG_INTERNAL_NOTICE}
    </span>
  );
}

/**
 * The Daily Log, where the technician actually is.
 *
 * "Auto-generate Daily Log the moment a technician finishes a Capture/photo
 * upload session, surfaced as a lightweight, always-available result right
 * there in the Capture flow rather than something requiring a trip to Reports
 * to manually generate."
 *
 * So this sits under the photo grid on the Photos tab - the tab you are on
 * while capturing - and it is deliberately plain. No cover art, no share
 * button, no PDF: those belong to the AI Summary and the Report, which are the
 * things a client sees. This is a list of what was done, on the page where it
 * was done, and its loudest visual element is the label saying nobody outside
 * the company reads it.
 *
 * The card is always present once the project has a log, whether or not the
 * user just uploaded something. "Always-available" was the word used, and a
 * panel that only appears in the seconds after an upload is a toast with extra
 * steps.
 */
export function ProjectDailyLog({
  projectId,
  logs,
  generating,
}: {
  projectId: string;
  /** Newest day first, as `listProjectDailyLogs` returns them. */
  logs: DailyLogSummary[];
  /** A capture session just finished and its section is still being written. */
  generating?: boolean;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [latest, ...earlier] = logs;

  /*
   * Nothing to show and nothing on the way. Rendering an empty card here would
   * put a permanent "no daily log yet" placeholder under every photo grid; the
   * log announces itself by appearing the first time photos are added, which
   * is a better introduction than a box explaining what would go in it.
   *
   * The page's own loading flag is deliberately not consulted: it is true on
   * every project's first paint, so honouring it would flash a skeleton daily
   * log onto jobs that have never had one.
   */
  if (!logs.length && !generating) return null;

  return (
    <section className={cn(SURFACE_CARD, "mt-6 overflow-hidden")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600">
            <NotebookPen className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">Daily Log</p>
            <p className="truncate text-[11px] text-muted-foreground">
              Written automatically from each capture session.
            </p>
          </div>
        </div>
        <InternalOnlyBadge />
      </div>

      <div className="px-4 py-3">
        {!latest ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Writing today&apos;s log…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {dayLabel(latest.createdAt)} · {relativeTime(latest.updatedAt)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {latest.photoCount} {latest.photoCount === 1 ? "photo" : "photos"}
              </p>
            </div>
            <ul className="mt-2 space-y-1.5">
              {latest.entries.slice(0, PREVIEW_ENTRIES).map((entry, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0">{entry}</span>
                </li>
              ))}
              {latest.entries.length === 0 && (
                <li className="text-sm text-muted-foreground">
                  No entries yet for this log&apos;s sessions.
                </li>
              )}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                to="/projects/$projectId/pages/$pageId"
                params={{ projectId, pageId: latest.pageId }}
                className="text-xs font-bold text-primary hover:underline"
              >
                Open daily log
                {latest.entries.length > PREVIEW_ENTRIES
                  ? ` (${latest.entries.length - PREVIEW_ENTRIES} more)`
                  : ""}
              </Link>
              {generating && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Adding this session…
                </span>
              )}
            </div>
          </>
        )}

        {earlier.length > 0 && (
          <div className="mt-3 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setShowEarlier((v) => !v)}
              aria-expanded={showEarlier}
              className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              {showEarlier ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Earlier days ({earlier.length})
            </button>
            {showEarlier && (
              <ul className="mt-2 space-y-1">
                {earlier.map((log) => (
                  <li key={log.pageId}>
                    <Link
                      to="/projects/$projectId/pages/$pageId"
                      params={{ projectId, pageId: log.pageId }}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                    >
                      <span className="min-w-0 truncate">{log.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {log.entries.length} {log.entries.length === 1 ? "entry" : "entries"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export { InternalOnlyBadge };
