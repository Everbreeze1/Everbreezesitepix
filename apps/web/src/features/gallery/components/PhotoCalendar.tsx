import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  addYears,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Camera,
  FolderKanban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhotoThumb } from "@/components/PhotoThumb";
import { SURFACE_CARD } from "@/components/ui/surface";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import { listTimelineActivity, type TimelineDay } from "@/lib/timeline.functions";
import { cn } from "@/lib/utils";
import { cleanCaption } from "@sitepix/shared";

export interface CalendarPhoto {
  id: string;
  project_id: string;
  storage_path: string;
  /** Pre-generated thumbnail; null for photos uploaded before they existed. */
  thumb_path?: string | null;
  image_url: string | null;
  caption: string | null;
  created_at: string;
  taken_at?: string | null;
  phase?: string | null;
  tags?: string[] | null;
}

/** One day's panel is a panel, not a feed. Past this we'd be scrolling forever. */
const DAY_PHOTO_LIMIT = 500;

/**
 * A PostgREST array literal with every element quoted.
 *
 * `.overlaps()` joins the values on commas and quotes nothing, so a tag that
 * contains a comma would silently split into two and match the wrong photos.
 */
const pgArray = (values: string[]) =>
  `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

type View = "month" | "year";

const WEEKDAYS = [
  { key: "sun", label: "S" },
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
];

/** Local calendar day key. Deliberately not UTC — a photo taken at 9pm belongs
 *  to the day the crew was on site, not to tomorrow in London. */
const dayKey = (d: Date) => format(d, "yyyy-MM-dd");

/** The instant a photo was actually captured, falling back to when it synced. */
const shotAt = (p: CalendarPhoto) => p.taken_at ?? p.created_at;

/** The viewer's IANA zone, or undefined on the rare runtime that withholds it. */
const viewerTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Month view of the photo library, with a year heatmap behind the same header.
 *
 * The grid alone answered "what have we got", but nothing on the page answered
 * "what happened on the 12th" or "which weeks were busy" — the questions people
 * actually bring to a field-photo archive. Each day cell is its own thumbnail,
 * so the month reads as a contact sheet of the job, and picking a day loads
 * that day's captures beside it.
 *
 * ## Why this fetches its own data
 *
 * Day counts come from the `listTimelineActivity` aggregate rather than from a
 * page of photos counted in the browser. Counting client-side meant the page
 * had to pull every photo in the month up front, which both cost a large query
 * for 31 thumbnails and silently under-reported any month that overran the row
 * limit — the calendar's whole job is the counts, so a count that is quietly
 * short is worse than no calendar. The selected day's photos are then fetched
 * on their own, so the cost tracks what you actually open.
 *
 * Parents that own a lightbox get the day's photos back through
 * `onDayPhotosChange` and the clicked one through `onOpenPhoto`.
 */
export function PhotoCalendar({
  month,
  onMonthChange,
  projectIds = [],
  tags = [],
  projects,
  selectedDay,
  onSelectDay,
  onOpenPhoto,
  onDayPhotosChange,
  showProjectBreakdown = true,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  /** Empty means every project the viewer can see. */
  projectIds?: string[];
  /** Any-of tag filter, applied server-side so day counts respect it too. */
  tags?: string[];
  projects: Array<{ id: string; name: string }>;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onOpenPhoto?: (photo: CalendarPhoto, dayPhotos: CalendarPhoto[]) => void;
  /** Mirrors the day's loaded photos up, for a parent-owned lightbox. */
  onDayPhotosChange?: (photos: CalendarPhoto[], signed: Record<string, string>) => void;
  /** Off when the whole view is already one project and the list would say nothing. */
  showProjectBreakdown?: boolean;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [view, setView] = useState<View>("month");

  // Sorted so two filter selections that differ only in click order share one
  // cache entry rather than each fetching the same month.
  const scopeIds = useMemo(() => [...projectIds].sort(), [projectIds]);
  const scopeTags = useMemo(() => [...tags].sort(), [tags]);

  const range = useMemo(() => {
    const from = view === "month" ? startOfMonth(month) : startOfYear(month);
    const to =
      view === "month" ? startOfMonth(addMonths(month, 1)) : startOfYear(addYears(month, 1));
    return { from: from.toISOString(), to: to.toISOString() };
  }, [view, month]);

  const activityQuery = useQuery({
    queryKey: qk.photoActivity(userId, {
      from: range.from,
      to: range.to,
      projectIds: scopeIds,
      tags: scopeTags,
      thumbs: view === "month",
    }),
    queryFn: () =>
      listTimelineActivity({
        data: {
          from: range.from,
          to: range.to,
          projectIds: scopeIds.length ? scopeIds : undefined,
          tags: scopeTags.length ? scopeTags : undefined,
          // The zone, not just today's offset: the day panel builds its window
          // from a real local date, so bucketing the cells on a frozen offset
          // makes the two disagree either side of a daylight-saving change.
          timeZone: viewerTimeZone(),
          tzOffsetMinutes: new Date().getTimezoneOffset(),
          // The year heatmap only needs counts; skipping thumbnails there
          // avoids ~365 signed-URL requests for pixels nobody sees.
          withThumbnails: view === "month",
        },
      }),
    enabled: !!user,
    staleTime: 60_000,
  });

  const days = useMemo(() => activityQuery.data?.days ?? [], [activityQuery.data]);
  const byDate = useMemo(() => {
    const m = new Map<string, TimelineDay>();
    for (const d of days) m.set(d.date, d);
    return m;
  }, [days]);

  const totalPhotos = activityQuery.data?.totalPhotos ?? 0;
  const activeDays = days.filter((d) => d.photoCount > 0).length;
  const projectsTouched = useMemo(() => new Set(days.flatMap((d) => d.projectNames)).size, [days]);
  const busiest = useMemo(() => Math.max(1, ...days.map((d) => d.photoCount)), [days]);

  // --- The selected day's actual photos -------------------------------------

  const dayQuery = useQuery({
    queryKey: qk.photoDay(userId, {
      day: selectedDay ?? "",
      projectIds: scopeIds,
      tags: scopeTags,
    }),
    queryFn: () => loadDayPhotos(selectedDay!, scopeIds, scopeTags),
    enabled: !!user && !!selectedDay,
    staleTime: 60_000,
  });

  const dayPhotos = dayQuery.data?.photos ?? [];
  const daySigned = dayQuery.data?.signed ?? {};

  // Held in a ref so a parent passing an inline arrow doesn't re-fire this on
  // every render — the effect should track the data, not the callback.
  const reportRef = useRef(onDayPhotosChange);
  reportRef.current = onDayPhotosChange;
  useEffect(() => {
    reportRef.current?.(dayQuery.data?.photos ?? [], dayQuery.data?.signed ?? {});
  }, [dayQuery.data]);

  const gridDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  const selected = selectedDay ? new Date(`${selectedDay}T00:00:00`) : null;
  const selectedCell = selectedDay ? byDate.get(selectedDay) : undefined;
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Unassigned";

  const step = (dir: -1 | 1) => {
    onMonthChange(view === "month" ? addMonths(month, dir) : addYears(month, dir));
  };

  return (
    <div
      className={cn(
        "mt-4 grid gap-4 lg:items-start",
        view === "month" && "lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]",
      )}
    >
      <Card className={cn(SURFACE_CARD, "p-4 sm:p-5")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
              Capture calendar
            </p>
            <h2 className="font-display mt-1.5 text-2xl font-bold leading-none tracking-[-0.6px]">
              {view === "month" ? format(month, "MMMM yyyy") : format(month, "yyyy")}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Month vs year. The year view answers "which stretches were busy",
                which no amount of paging through months does well. */}
            <div className="inline-flex items-center gap-0.5 rounded-full bg-muted p-0.5">
              {(["month", "year"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setView(v);
                    onSelectDay(null);
                  }}
                  aria-pressed={view === v}
                  className={cn(
                    "h-7 rounded-full px-3 font-manrope text-xs font-bold capitalize transition",
                    view === v
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => onMonthChange(startOfMonth(new Date()))}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => step(-1)}
                aria-label={view === "month" ? "Previous month" : "Previous year"}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => step(1)}
                aria-label={view === "month" ? "Next month" : "Next year"}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {/* A failed load must not read as an empty month — this whole view
              exists to be trusted about counts. */}
          {activityQuery.isError ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Couldn&apos;t load this {view}&apos;s activity
              <button
                type="button"
                onClick={() => void activityQuery.refetch()}
                className="underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            </span>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                <Camera className="h-3.5 w-3.5" />
                {totalPhotos.toLocaleString()} photo{totalPhotos === 1 ? "" : "s"}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                {activeDays} active day{activeDays === 1 ? "" : "s"}
              </span>
              {showProjectBreakdown && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                  <FolderKanban className="h-3.5 w-3.5" />
                  {projectsTouched} project{projectsTouched === 1 ? "" : "s"}
                </span>
              )}
              {activityQuery.data?.capped && (
                <span className="text-[11.5px] font-bold text-amber-600 dark:text-amber-400">
                  Too much activity to count exactly — totals are a floor
                </span>
              )}
            </>
          )}
        </div>

        {view === "month" ? (
          <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS.map((d) => (
              <div
                key={d.key}
                className="pb-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground"
              >
                {d.label}
              </div>
            ))}

            {gridDays.map((day) => {
              const k = dayKey(day);
              const cell = byDate.get(k);
              const count = cell?.photoCount ?? 0;
              const outside = !isSameMonth(day, month);
              const isSelected = selectedDay === k;
              // Shade populated cells by how busy they were relative to the
              // month's busiest day; empty in-month cells stay flat.
              const density = count / busiest;

              return (
                <button
                  key={k}
                  type="button"
                  disabled={outside}
                  onClick={() => onSelectDay(isSelected ? null : k)}
                  aria-label={`${format(day, "EEEE d MMMM")} — ${count} photo${
                    count === 1 ? "" : "s"
                  }`}
                  aria-pressed={isSelected}
                  className={cn(
                    "group relative aspect-square overflow-hidden rounded-xl border text-left transition",
                    outside
                      ? "cursor-default border-transparent opacity-30"
                      : "border-border hover:border-primary/50",
                    isSelected && "border-primary ring-2 ring-primary/25",
                    !cell?.coverUrl && !outside && "bg-muted/30",
                  )}
                >
                  {cell?.coverUrl ? (
                    <>
                      {/* Signed by the server in one batch with the counts, so
                          a month costs no per-tile signing round trips. */}
                      <img
                        src={cell.coverUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                      <span
                        aria-hidden
                        className="absolute inset-0 bg-gradient-to-t from-sidebar/95 via-sidebar/40 to-sidebar/10"
                        style={{ opacity: 0.55 + density * 0.35 }}
                      />
                      <span className="absolute left-1.5 top-1 text-[11px] font-extrabold text-sidebar-foreground drop-shadow">
                        {format(day, "d")}
                      </span>
                      <span className="absolute bottom-1 right-1.5 rounded-full bg-sidebar-foreground/90 px-1.5 text-[10px] font-extrabold tabular-nums text-sidebar">
                        {count}
                      </span>
                    </>
                  ) : (
                    <span
                      className={cn(
                        "absolute left-1.5 top-1 text-[11px] font-bold",
                        isToday(day) ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                  )}
                  {isToday(day) && (
                    <span
                      aria-hidden
                      className="absolute bottom-1 left-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <YearHeatmap
            year={month.getFullYear()}
            byDate={byDate}
            busiest={busiest}
            onPickMonth={(m) => {
              onMonthChange(new Date(month.getFullYear(), m, 1));
              setView("month");
            }}
          />
        )}

        {activityQuery.isPending && (
          <p className="mt-3 text-center text-xs text-muted-foreground">Loading activity…</p>
        )}
      </Card>

      {/* The "related pictures on the side" half. */}
      {view === "month" && (
        <Card className={cn(SURFACE_CARD, "overflow-hidden p-0 lg:sticky lg:top-4")}>
          <div className="border-b border-border/60 px-4 py-3.5">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
              {selected ? "Selected day" : "Pick a day"}
            </p>
            <h3 className="font-display mt-1.5 text-xl font-bold leading-none tracking-[-0.4px]">
              {selected ? format(selected, "EEEE, d MMM") : "Nothing selected"}
            </h3>
            <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
              {selected
                ? `${(selectedCell?.photoCount ?? dayPhotos.length).toLocaleString()} capture${
                    (selectedCell?.photoCount ?? dayPhotos.length) === 1 ? "" : "s"
                  }`
                : "Tap a date to see what the crew shot that day."}
            </p>
          </div>

          <div className="max-h-[520px] overflow-y-auto p-3">
            {!selected ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <CalendarDays className="h-6 w-6 text-muted-foreground/60" />
                <p className="max-w-[200px] text-xs text-muted-foreground">
                  Days with captures show a thumbnail and a count.
                </p>
              </div>
            ) : dayQuery.isError ? (
              // Same reasoning as the header: "no photos" and "we couldn't ask"
              // must not look identical.
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-xs font-semibold text-destructive">
                  Couldn&apos;t load this day
                </p>
                <button
                  type="button"
                  onClick={() => void dayQuery.refetch()}
                  className="text-xs underline underline-offset-2 hover:no-underline"
                >
                  Retry
                </button>
              </div>
            ) : dayQuery.isPending ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : dayPhotos.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No photos on this day.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {dayPhotos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!onOpenPhoto}
                      onClick={() => onOpenPhoto?.(p, dayPhotos)}
                      title={cleanCaption(p.caption) ?? projectName(p.project_id)}
                      className={cn(
                        "group relative aspect-square overflow-hidden rounded-lg bg-muted",
                        onOpenPhoto && "transition hover:ring-2 hover:ring-primary/40",
                      )}
                    >
                      <PhotoThumb
                        storagePath={p.storage_path}
                        thumbPath={p.thumb_path}
                        fallbackUrl={daySigned[p.id]}
                        width={160}
                        alt={p.caption ?? ""}
                        className="transition duration-300 group-hover:scale-105"
                      />
                    </button>
                  ))}
                </div>

                {dayPhotos.length < (selectedCell?.photoCount ?? 0) && (
                  <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
                    Showing the first {dayPhotos.length.toLocaleString()} of{" "}
                    {selectedCell!.photoCount.toLocaleString()}.
                  </p>
                )}

                {/* Which jobs the day belonged to — the question a date alone
                    can't answer. */}
                {showProjectBreakdown && (
                  <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
                    {Object.entries(
                      dayPhotos.reduce<Record<string, number>>((acc, p) => {
                        acc[p.project_id] = (acc[p.project_id] ?? 0) + 1;
                        return acc;
                      }, {}),
                    )
                      .sort((a, b) => b[1] - a[1])
                      .map(([id, n]) => (
                        <div key={id} className="flex items-center gap-2 text-xs">
                          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {projectName(id)}
                          </span>
                          <span className="shrink-0 font-semibold text-muted-foreground">{n}</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Year view as activity density rather than thumbnails: 365 small images is
 * visual noise, whereas shading makes busy stretches and idle weeks legible at
 * a glance. Click a month to drop into the thumbnail view.
 */
function YearHeatmap({
  year,
  byDate,
  busiest,
  onPickMonth,
}: {
  year: number;
  byDate: Map<string, TimelineDay>;
  busiest: number;
  onPickMonth: (month: number) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 12 }, (_, m) => {
        const first = new Date(year, m, 1);
        const cells = eachDayOfInterval({
          start: startOfWeek(first),
          end: endOfWeek(endOfMonth(first)),
        });
        const monthTotal = cells.reduce(
          (n, d) => n + (isSameMonth(d, first) ? (byDate.get(dayKey(d))?.photoCount ?? 0) : 0),
          0,
        );
        return (
          <button
            key={m}
            type="button"
            onClick={() => onPickMonth(m)}
            className="rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/50 hover:shadow-md"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-foreground">
                {format(first, "MMMM")}
              </span>
              <span className="text-xs text-muted-foreground">
                {monthTotal > 0 ? `${monthTotal.toLocaleString()} photos` : "—"}
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-7 gap-1">
              {cells.map((d) => {
                if (!isSameMonth(d, first))
                  return <span key={`pad-${dayKey(d)}`} className="aspect-square" />;
                const count = byDate.get(dayKey(d))?.photoCount ?? 0;
                // Square-root scale: with linear shading a single huge day
                // flattens every ordinary one into the same near-empty tone.
                const intensity = count === 0 ? 0 : Math.sqrt(count / busiest);
                return (
                  <span
                    key={dayKey(d)}
                    title={`${format(d, "d MMM")} — ${count} photo${count === 1 ? "" : "s"}`}
                    className={cn("aspect-square rounded-[2px]", count === 0 && "bg-muted")}
                    style={
                      count > 0
                        ? {
                            backgroundColor: `color-mix(in srgb, var(--color-primary) ${Math.round(
                              20 + intensity * 80,
                            )}%, transparent)`,
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One day's captures.
 *
 * Windowed on `taken_at` with a `created_at` fallback so it lines up exactly
 * with how the server buckets the day cells — otherwise a photo shot at 6pm and
 * synced the next morning would be counted on one day and listed under another.
 * Walkthrough frames are dropped client-side rather than in the query, because
 * PostgREST allows only one top-level `or` group and the date window needs it.
 */
async function loadDayPhotos(
  day: string,
  projectIds: string[],
  tags: string[],
): Promise<{ photos: CalendarPhoto[]; signed: Record<string, string> }> {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const from = start.toISOString();
  const to = end.toISOString();

  let q = supabase
    .from("photos")
    .select(
      "id, project_id, storage_path, thumb_path, image_url, caption, phase, tags, taken_at, created_at",
    )
    .eq("archived", false)
    .is("deleted_at", null)
    .not("storage_path", "like", "%/walkthroughs/%")
    .or(
      `and(taken_at.gte.${from},taken_at.lt.${to}),and(taken_at.is.null,created_at.gte.${from},created_at.lt.${to})`,
    )
    .order("taken_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(DAY_PHOTO_LIMIT);
  if (projectIds.length) q = q.in("project_id", projectIds);
  if (tags.length) q = q.filter("tags", "ov", pgArray(tags));

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const photos = ((data as CalendarPhoto[]) ?? [])
    .filter((p) => p.phase !== "walkthrough" && !p.storage_path?.includes("/walkthroughs/"))
    .sort((a, b) => +new Date(shotAt(b)) - +new Date(shotAt(a)));

  const signed: Record<string, string> = {};
  if (photos.length) {
    const { data: urls } = await supabase.storage.from("site-photos").createSignedUrls(
      photos.map((p) => p.storage_path),
      3600,
    );
    urls?.forEach((s, i) => {
      if (s.signedUrl) signed[photos[i].id] = s.signedUrl;
    });
  }
  return { photos, signed };
}
