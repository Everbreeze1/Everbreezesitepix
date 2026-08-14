import { useEffect, useRef, useState } from "react";

interface Options {
  onRefresh: () => Promise<unknown> | unknown;
  /** Pull distance (in px) needed to trigger refresh. */
  threshold?: number;
  /** Disable on desktop / when not needed. */
  enabled?: boolean;
}

/**
 * Simple, mobile-first pull-to-refresh hook.
 * Attach the returned `bind` ref to a scrollable container (or window-level by default).
 * Renders nothing - exposes `pulling` distance and `refreshing` so the consumer can show an indicator.
 */
export function usePullToRefresh({ onRefresh, threshold = 70, enabled = true }: Options) {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) return;
      startY.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 0) {
        // dampening
        setPull(Math.min(threshold * 1.5, dy * 0.55));
      } else {
        setPull(0);
      }
    };
    const onTouchEnd = async () => {
      if (startY.current == null) return;
      const shouldRefresh = pull >= threshold && !refreshing;
      startY.current = null;
      if (shouldRefresh) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, onRefresh, pull, refreshing, threshold]);

  return {
    pull,
    refreshing,
    /** Inline style helper for the indicator (translateY based on current pull). */
    indicatorStyle: {
      transform: `translateY(${Math.min(pull, threshold)}px)`,
      opacity: Math.min(1, pull / threshold),
    } as const,
    progress: Math.min(1, pull / threshold),
  };
}
