import { useMemo } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Camera, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PhotoThumb } from "@/components/PhotoThumb";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { cleanCaption } from "@sitepix/shared";

export interface CalendarPhoto {
  id: string;
  project_id: string;
  storage_path: string;
  image_url: string | null;
  caption: string | null;
  created_at: string;
}

/** Local calendar day key. Deliberately not UTC — a photo taken at 9pm belongs
 *  to the day the crew was on site, not to tomorrow in London. */
const dayKey = (iso: string | Date) => format(new Date(iso), "yyyy-MM-dd");

const WEEKDAYS = [
  { key: "sun", label: "S" },
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
];

/**
 * Month view of the photo library.
 *
 * The grid alone answered "what have we got", but nothing on the page answered
 * "what happened on the 12th" or "which weeks were busy" — the questions people
 * actually bring to a field-photo archive. Each day cell is its own thumbnail,
 * so the month reads as a contact sheet of the job, and picking a day loads
 * that day's captures beside it.
 */
export function PhotoCalendar<T extends CalendarPhoto>({
  month,
  onMonthChange,
  photos,
  signed,
  projects,
  selectedDay,
  onSelectDay,
  onOpenPhoto,
  loading,
  capped,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  /** Photos already scoped to `month` and passed through the active filters. */
  photos: T[];
  signed: Record<string, string>;
  projects: Array<{ id: string; name: string }>;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  /** Receives the caller's own photo type back, so no cast at the call site. */
  onOpenPhoto: (photo: T) => void;
  loading: boolean;
  /** The month's query hit its row limit, so counts may be short. */
  capped: boolean;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const p of photos) {
      const k = dayKey(p.created_at);
      const bucket = map.get(k);
      if (bucket) bucket.push(p);
      else map.set(k, [p]);
    }
    // Newest first within a day, matching the grid's ordering.
    for (const bucket of map.values())
      bucket.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return map;
  }, [photos]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month)),
        end: endOfWeek(endOfMonth(month)),
      }),
    [month],
  );

  /** Busiest day sets the ceiling for the density shading. */
  const busiest = useMemo(() => {
    let max = 0;
    for (const [, list] of byDay) max = Math.max(max, list.length);
    return max;
  }, [byDay]);

  const activeDays = byDay.size;
  const projectsTouched = useMemo(() => new Set(photos.map((p) => p.project_id)).size, [photos]);

  const selected = selectedDay ? new Date(`${selectedDay}T00:00:00`) : null;
  const selectedPhotos = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "Unassigned";

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-start">
      <Card className={cn(SURFACE_CARD, "p-4 sm:p-5")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
              Capture calendar
            </p>
            <h2 className="font-display mt-1.5 text-2xl font-bold leading-none tracking-[-0.6px]">
              {format(month, "MMMM yyyy")}
            </h2>
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
              onClick={() => onMonthChange(subMonths(month, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onMonthChange(addMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
            <Camera className="h-3.5 w-3.5" />
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" />
            {activeDays} active day{activeDays === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
            <FolderKanban className="h-3.5 w-3.5" />
            {projectsTouched} project{projectsTouched === 1 ? "" : "s"}
          </span>
          {capped && (
            <span className="text-[11.5px] font-bold text-amber-600 dark:text-amber-400">
              Showing the most recent captures only — counts may be short
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-1.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d.key}
              className="pb-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground"
            >
              {d.label}
            </div>
          ))}

          {days.map((day) => {
            const k = dayKey(day);
            const dayPhotos = byDay.get(k) ?? [];
            const outside = !isSameMonth(day, month);
            const isSelected = !!selected && isSameDay(day, selected);
            const cover = dayPhotos[0];
            // Shade empty-but-in-month cells by nothing; shade populated ones by
            // how busy they were relative to the month's busiest day.
            const density = busiest > 0 ? dayPhotos.length / busiest : 0;

            return (
              <button
                key={k}
                type="button"
                disabled={outside}
                onClick={() => onSelectDay(isSelected ? null : k)}
                aria-label={`${format(day, "EEEE d MMMM")} — ${dayPhotos.length} photo${
                  dayPhotos.length === 1 ? "" : "s"
                }`}
                aria-pressed={isSelected}
                className={cn(
                  "group relative aspect-square overflow-hidden rounded-xl border text-left transition",
                  outside
                    ? "cursor-default border-transparent opacity-30"
                    : "border-border hover:border-primary/50",
                  isSelected && "border-primary ring-2 ring-primary/25",
                  !cover && !outside && "bg-muted/30",
                )}
              >
                {cover ? (
                  <>
                    <PhotoThumb
                      storagePath={cover.storage_path}
                      fallbackUrl={signed[cover.id]}
                      width={200}
                      alt=""
                      className="transition duration-300 group-hover:scale-105"
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
                      {dayPhotos.length}
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
      </Card>

      {/* The "related pictures on the side" half. */}
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
              ? `${selectedPhotos.length} capture${selectedPhotos.length === 1 ? "" : "s"}`
              : "Tap a date to see what the crew shot that day."}
          </p>
        </div>

        <div className="max-h-[520px] overflow-y-auto p-3">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : !selected ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CalendarDays className="h-6 w-6 text-muted-foreground/60" />
              <p className="max-w-[200px] text-xs text-muted-foreground">
                Days with captures show a thumbnail and a count.
              </p>
            </div>
          ) : selectedPhotos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No photos on this day.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {selectedPhotos.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenPhoto(p)}
                    title={cleanCaption(p.caption) ?? projectName(p.project_id)}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-muted transition hover:ring-2 hover:ring-primary/40"
                  >
                    <PhotoThumb
                      storagePath={p.storage_path}
                      fallbackUrl={signed[p.id]}
                      width={160}
                      alt={p.caption ?? ""}
                      className="transition duration-300 group-hover:scale-105"
                    />
                  </button>
                ))}
              </div>

              {/* Which jobs the day belonged to — the question a date alone
                  can't answer. */}
              <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
                {Object.entries(
                  selectedPhotos.reduce<Record<string, number>>((acc, p) => {
                    acc[p.project_id] = (acc[p.project_id] ?? 0) + 1;
                    return acc;
                  }, {}),
                )
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, n]) => (
                    <div key={id} className="flex items-center gap-2 text-xs">
                      <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{projectName(id)}</span>
                      <span className="shrink-0 font-semibold text-muted-foreground">{n}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
