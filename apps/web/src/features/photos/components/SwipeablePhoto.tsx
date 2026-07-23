import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  src: string;
  alt?: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  overlay?: ReactNode;
  className?: string;
};

/**
 * Full-photo viewer with horizontal swipe + keyboard arrow navigation.
 * Renders subtle left/right chevrons that fade in during a swipe.
 */
export function SwipeablePhoto({
  src,
  alt = "",
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  overlay,
  className,
}: Props) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);

  // keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev) onPrev();
      else if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onPrev, onNext]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    setAnimating(false);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current == null || startY.current == null) return;
    const t = e.touches[0];
    const deltaX = t.clientX - startX.current;
    const deltaY = t.clientY - startY.current;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      setDx(deltaX);
    }
  };

  const onTouchEnd = () => {
    const threshold = 60;
    setAnimating(true);
    if (dx <= -threshold && hasNext) {
      onNext();
    } else if (dx >= threshold && hasPrev) {
      onPrev();
    }
    setDx(0);
    startX.current = null;
    startY.current = null;
  };

  const onTouchCancel = () => {
    setAnimating(true);
    setDx(0);
    startX.current = null;
    startY.current = null;
  };

  const arrowOpacity = Math.min(1, Math.abs(dx) / 80);

  return (
    <div
      className={`relative overflow-hidden touch-pan-y select-none ${className ?? ""}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: animating ? "transform 200ms ease-out" : "none",
        }}
      >
        <img src={src} alt={alt} className="w-full block" draggable={false} />
        {overlay}
      </div>

      {/* Prev chevron */}
      {hasPrev && (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={onPrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 hidden md:flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/60"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          aria-label="Next photo"
          onClick={onNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 hidden md:flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/60"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      {/* Swipe indicator chevrons (mobile) */}
      {hasPrev && dx > 10 && (
        <div
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
          style={{ opacity: arrowOpacity }}
        >
          <ChevronLeft className="h-6 w-6" />
        </div>
      )}
      {hasNext && dx < -10 && (
        <div
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
          style={{ opacity: arrowOpacity }}
        >
          <ChevronRight className="h-6 w-6" />
        </div>
      )}
    </div>
  );
}
