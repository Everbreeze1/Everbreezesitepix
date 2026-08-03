import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listTimelineActivity, type TimelineDay } from "@/lib/timeline.functions";

type View = "month" | "year";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** YYYY-MM-DD in local time — the same key the server buckets on. */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Days of `month`, padded to whole weeks starting Monday so the grid always has
 * aligned columns. Padding slots come back as null.
 */
function monthGrid(year: number, month: number): Array<Date | null> {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay() is Sunday-indexed; shift so Monday is column 0.
  const lead = (first.getDay() + 6) % 7;
  const cells: Array<Date | null> = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * The timeline itself: month grid with photo thumbnails, year view as an
 * activity heatmap.
 *
 * Shared by the company-wide /timeline page and the per-project tab so the two
 * can never drift — which matters because they are the free and paid halves of
 * the same feature and users will compare them directly. Pass `projectId` to
 * scope it to one job.
 */
export function TimelineCalendar({ projectId }: { projectId?: string }) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TimelineDay | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const from = view === "month" ? new Date(year, month, 1) : new Date(year, 0, 1);
        const to = view === "month" ? new Date(year, month + 1, 1) : new Date(year + 1, 0, 1);
        const res = await listTimelineActivity({
          data: {
            from: from.toISOString(),
            to: to.toISOString(),
            projectId,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
            // The year heatmap only needs counts; skipping thumbnails there
            // avoids ~365 signed-URL requests for pixels nobody sees.
            withThumbnails: view === "month",
          },
        });
        if (!cancelled) setDays(res.days);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Could not load activity");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, view, year, month]);

  const byDate = useMemo(() => {
    const m = new Map<string, TimelineDay>();
    days.forEach((d) => m.set(d.date, d));
    return m;
  }, [days]);

  const busiest = useMemo(() => Math.max(1, ...days.map((d) => d.photoCount)), [days]);
  const totalPhotos = days.reduce((n, d) => n + d.photoCount, 0);
  const activeDays = days.filter((d) => d.photoCount > 0).length;

  const step = (dir: -1 | 1) =>
    setCursor(view === "month" ? new Date(year, month + dir, 1) : new Date(year + dir, month, 1));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[11rem] text-center text-lg font-extrabold tracking-tight text-foreground">
            {view === "month" ? `${MONTHS[month]} ${year}` : year}
          </div>
          <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="ml-1" onClick={() => setCursor(new Date())}>
            Today
          </Button>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {(["month", "year"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "default" : "ghost"}
              className="h-8 capitalize"
              onClick={() => setView(v)}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{totalPhotos.toLocaleString()}</strong> photos
        </span>
        <span>
          <strong className="text-foreground">{activeDays}</strong> active{" "}
          {activeDays === 1 ? "day" : "days"}
        </span>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : days.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing captured here"
            description={
              view === "month"
                ? "No photos were taken in this month."
                : "No photos were taken in this year."
            }
          />
        ) : view === "month" ? (
          <MonthGrid year={year} month={month} byDate={byDate} onPick={setSelected} />
        ) : (
          <YearHeatmap
            year={year}
            byDate={byDate}
            busiest={busiest}
            onPickMonth={(m) => {
              setCursor(new Date(year, m, 1));
              setView("month");
            }}
          />
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selected &&
                new Date(`${selected.date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
            </DialogTitle>
            <DialogDescription>
              {selected?.photoCount} photo{selected?.photoCount === 1 ? "" : "s"}
              {/* Project count is noise when the whole view is already one project. */}
              {!projectId &&
                ` across ${selected?.projectCount} project${selected?.projectCount === 1 ? "" : "s"}`}
            </DialogDescription>
          </DialogHeader>
          {selected?.coverUrl && (
            <img
              src={selected.coverUrl}
              alt=""
              className="aspect-video w-full rounded-lg object-cover"
            />
          )}
          {!projectId && !!selected?.projectNames.length && (
            <div className="flex flex-wrap gap-1.5">
              {selected.projectNames.map((n) => (
                <span
                  key={n}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground"
                >
                  {n}
                </span>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MonthGrid({
  year,
  month,
  byDate,
  onPick,
}: {
  year: number;
  month: number;
  byDate: Map<string, TimelineDay>;
  onPick: (d: TimelineDay) => void;
}) {
  const cells = monthGrid(year, month);
  const today = dateKey(new Date());

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date, i) => {
          if (!date) {
            return (
              <div
                key={`pad-${i}`}
                className="aspect-square border-b border-r border-border/60 bg-muted/20"
              />
            );
          }
          const key = dateKey(date);
          const day = byDate.get(key);
          const isToday = key === today;
          return (
            <button
              key={key}
              type="button"
              disabled={!day}
              onClick={() => day && onPick(day)}
              className={cn(
                "group relative aspect-square border-b border-r border-border/60 text-left transition",
                day ? "cursor-pointer hover:z-10 hover:ring-2 hover:ring-primary" : "cursor-default",
              )}
            >
              {day?.coverUrl && (
                <>
                  <img src={day.coverUrl} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                </>
              )}
              <span
                className={cn(
                  "absolute left-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold tabular-nums",
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : day?.coverUrl
                      ? "text-white"
                      : "text-muted-foreground",
                )}
              >
                {date.getDate()}
              </span>
              {day && (
                <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate text-[10px] font-bold text-white drop-shadow">
                  {day.photoCount} photo{day.photoCount === 1 ? "" : "s"}
                </span>
              )}
            </button>
          );
        })}
      </div>
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {MONTHS.map((label, m) => {
        const cells = monthGrid(year, m);
        const monthTotal = cells.reduce(
          (n, d) => n + (d ? (byDate.get(dateKey(d))?.photoCount ?? 0) : 0),
          0,
        );
        return (
          <button
            key={label}
            type="button"
            onClick={() => onPickMonth(m)}
            className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/50 hover:shadow-md"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-extrabold text-foreground">{label}</span>
              <span className="text-xs text-muted-foreground">
                {monthTotal > 0 ? `${monthTotal} photos` : "—"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                if (!date) return <span key={`p-${i}`} className="aspect-square" />;
                const count = byDate.get(dateKey(date))?.photoCount ?? 0;
                // Square-root scale: with linear shading a single huge day
                // flattens every ordinary one into the same near-empty tone.
                const intensity = count === 0 ? 0 : Math.sqrt(count / busiest);
                return (
                  <span
                    key={dateKey(date)}
                    title={`${date.toLocaleDateString()} — ${count} photo${count === 1 ? "" : "s"}`}
                    className={cn("aspect-square rounded-[2px]", count === 0 && "bg-muted")}
                    style={
                      count > 0
                        ? {
                            backgroundColor: `color-mix(in srgb, var(--color-primary) ${Math.round(20 + intensity * 80)}%, transparent)`,
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
