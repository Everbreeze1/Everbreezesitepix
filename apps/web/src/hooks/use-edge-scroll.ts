import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A horizontal scroller that says which way there is more to see.
 *
 * The pattern the client asked for twice, in the same words both times. First
 * about the pipeline tabs - "no arrow to move it, it hides there" - and then
 * about the board's own columns: "i can move it from side to side with a bar at
 * the bottom but these bars will eventually need to go away and have a cleaner
 * look, there should be an arrow or something on top".
 *
 * So a strip hides its scrollbar and earns that by saying what is off-screen:
 * an arrow on the side that has more, and a fade over that edge so a cut-off
 * item reads as "there is more" rather than as the end of the list. Hiding the
 * scrollbar without both of those is what stranded a pipeline tab off the right
 * edge with no way back.
 *
 * `watch` re-measures when the content changes. A ResizeObserver only fires on
 * the scroller's own box, and adding a column or a tab does not change that
 * box, only what is inside it.
 */
export function useEdgeScroll<T extends HTMLElement = HTMLDivElement>(
  watch: React.DependencyList = [],
) {
  const ref = useRef<T | null>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A pixel of slack: fractional widths mean scrollLeft rarely reaches the
    // exact maximum, which would leave the right arrow permanently lit.
    const max = el.scrollWidth - el.clientWidth;
    setOverflow({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [measure, ...watch]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  /**
   * Move one screenful-ish. `step` lets a caller land on its own grid - the
   * board scrolls by whole columns so a click never leaves half a card showing.
   */
  const nudge = useCallback((direction: -1 | 1, step?: number) => {
    const el = ref.current;
    if (!el) return;
    const amount = step ?? Math.max(160, el.clientWidth * 0.7);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  }, []);

  return { ref, overflow, measure, nudge };
}
