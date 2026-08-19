import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The little "?" that carries the long explanation a control used to print on
 * screen.
 *
 * The client's words about the Document templates banner: "replace the long
 * paragraph ... make it hidden behind a question mark ... Maybe a question mark
 * should be used beside every explainable thing, they can hover over it and get
 * a short sentence about what it does." So the page states the one line that
 * matters, and everything a first-timer needs sits one hover away instead of
 * six lines down the page.
 *
 * Built on Popover rather than Tooltip on purpose. A Radix tooltip never opens
 * on a tap, and half this product is used on a phone in a driveway, so a
 * hover-only hint would simply be missing there. This opens three ways:
 *
 *  - mouse over the "?" (and stays open while the pointer travels into it),
 *  - tap it, which pins it open until the next tap or a tap outside,
 *  - Tab to it and press Enter or Space.
 *
 * Screen readers never see the popover at all - they get `children` from the
 * `sr-only` span inside the button, which is always in the accessibility tree
 * and does not depend on the thing being open.
 */
export function HelpTip({
  children,
  label,
  side = "top",
  align = "center",
  className,
  triggerClassName,
}: {
  /** The explanation. A sentence or two; longer than that wants a page. */
  children: ReactNode;
  /** Names the thing being explained, for the button's accessible name. */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Overrides the bubble, e.g. `w-96` when a sentence needs the room. */
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  /** True once a click/tap opened it, so a stray pointerleave can't close it. */
  const pinned = useRef(false);
  /** Grace period for the gap between the "?" and the bubble. */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  useEffect(() => cancelClose, [cancelClose]);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (!pinned.current) setOpen(false);
    }, 140);
  }, [cancelClose]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Escape, or a click outside. Both mean "done with it".
        if (!next) {
          cancelClose();
          pinned.current = false;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${label}?`}
          onPointerEnter={(e) => {
            if (e.pointerType !== "mouse") return;
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            closeSoon();
          }}
          // Radix's own trigger handler does the opening and closing on a
          // click; this only records that the click was what did it, so a
          // pointer wandering off afterwards cannot take the bubble with it.
          // `open` here is the same value Radix's toggle is about to invert.
          onClick={() => {
            pinned.current = !open;
            cancelClose();
          }}
          // Keyboard only. Radix hands focus back to the trigger when the
          // bubble closes, and a plain onFocus would read that as "opened by
          // keyboard" and reopen it, which pins the bubble on screen for good
          // once the pointer has been near it. :focus-visible is false for that
          // programmatic focus and true for a Tab, which is exactly the split.
          onFocus={(e) => {
            if (!e.currentTarget.matches(":focus-visible")) return;
            cancelClose();
            setOpen(true);
          }}
          onBlur={closeSoon}
          className={cn(
            "inline-grid h-4 w-4 shrink-0 translate-y-[1px] place-items-center rounded-full text-current opacity-50 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            triggerClassName,
          )}
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
          {/* The same words, always available to a screen reader. */}
          <span className="sr-only">{children}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={12}
        // Hover-opened, so stealing focus would yank the caret out of whatever
        // the person was typing in.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Nor give it back on the way out, for the same reason.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={cancelClose}
        onPointerLeave={closeSoon}
        aria-hidden="true"
        className={cn(
          "w-72 rounded-xl p-3.5 text-xs font-medium leading-relaxed text-popover-foreground shadow-lg",
          className,
        )}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
