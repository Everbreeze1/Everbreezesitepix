import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectBoard } from "@/lib/project-boards.functions";

/**
 * The row of pipeline tabs.
 *
 * The strip has always scrolled horizontally, and it has always hidden its
 * scrollbar to keep the line clean. Those two together are what the client hit:
 *
 *   "when i add pipelines it gets created on the right side but no arrow to
 *    move it, it hides there."
 *
 * With no scrollbar and no arrows, a tab past the right edge was unreachable by
 * anything except a trackpad swipe, which is not a gesture a mouse has. The new
 * pipeline was created correctly and then vanished.
 *
 * Two fixes, and the second matters as much as the first:
 *
 *   Arrows, shown only on the side that actually has more to see, plus a fade
 *   over the edge so a cut-off tab reads as "there is more" rather than as the
 *   end of the list.
 *
 *   The "+" moved out of the scroller. It used to scroll away with the tabs, so
 *   once the strip overflowed there was no way to reach "Create pipeline"
 *   either. Anything that is always an option should always be on screen.
 */
export function PipelineTabStrip({
  boards,
  activeId,
  onSelect,
  onCreate,
}: {
  boards: ProjectBoard[];
  activeId: string | null;
  onSelect: (board: ProjectBoard) => void;
  onCreate: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // A pixel of slack: fractional widths mean scrollLeft rarely reaches the
    // exact maximum, which would leave the right arrow permanently lit.
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useLayoutEffect(measure, [measure, boards.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  /*
   * Bring the selected tab into view, including the one that was just created.
   *
   * Deliberately not `scrollIntoView`: with a horizontally scrolling strip
   * inside a vertically scrolling page, that also scrolls the page, which
   * yanks the board out from under the person. Setting `scrollLeft` moves this
   * element and nothing else.
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !activeId) return;
    const tab = el.querySelector<HTMLElement>(`[data-board-id="${CSS.escape(activeId)}"]`);
    if (!tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    const pad = 24;
    if (left < el.scrollLeft + pad) {
      el.scrollTo({ left: Math.max(0, left - pad), behavior: "smooth" });
    } else if (right > el.scrollLeft + el.clientWidth - pad) {
      el.scrollTo({ left: right - el.clientWidth + pad, behavior: "smooth" });
    }
  }, [activeId, boards.length]);

  function nudge(direction: -1 | 1) {
    const el = scroller.current;
    if (!el) return;
    // Most of a screenful, so a click makes obvious progress but never jumps
    // clean past a tab you were looking for.
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {overflow.left && <ArrowButton side="left" onClick={() => nudge(-1)} />}

      <div className="relative min-w-0 flex-1">
        <div
          ref={scroller}
          className="flex items-center gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {boards.map((b) => {
            const isActive = activeId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                data-board-id={b.id}
                onClick={() => onSelect(b)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold transition-colors",
                  isActive
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {b.name}
              </button>
            );
          })}
        </div>

        {/*
          A cut-off tab under a hard edge reads as the end of the list. Under a
          fade it reads as "there is more", which is the whole point of showing
          the arrow beside it.
        */}
        {overflow.left && (
          <span className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" />
        )}
        {overflow.right && (
          <span className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" />
        )}
      </div>

      {overflow.right && <ArrowButton side="right" onClick={() => nudge(1)} />}

      {/* Outside the scroller on purpose: creating a pipeline is always an option. */}
      <button
        type="button"
        onClick={onCreate}
        aria-label="Create pipeline"
        title="Create pipeline"
        className="-mb-px shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ArrowButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Scroll pipelines left" : "Scroll pipelines right"}
      className="-mb-px shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
