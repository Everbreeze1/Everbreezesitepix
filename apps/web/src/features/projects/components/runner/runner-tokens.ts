/**
 * Non-component exports for the in-project runners.
 *
 * Split out of `runner-ui.tsx` for the same reason `builder-tokens.ts` is split
 * out of `builder-ui.tsx`: that file exports components only, so fast refresh
 * keeps working.
 */

/**
 * The state of a run, which is the *only* thing allowed to drive colour in
 * these screens.
 *
 * `complete` is the loud one on purpose. The old checklist card gave
 * "In progress" a fully-saturated primary fill and finished work a pale wash,
 * so a wall of cards shouted about the unfinished ones. Workflows was worse -
 * it coloured cards `index % 3`, so the palette encoded list position and one
 * variant used the sidebar's pinned-navy token, which vanishes on a dark page.
 */
export type RunTone = "idle" | "active" | "complete" | "blocked";

export interface ToneClasses {
  /** Status pill: border + fill + text. */
  pill: string;
  /** Icon tile behind the leading glyph. */
  tile: string;
  /** Bare foreground colour, for inline icons and counts. */
  text: string;
  /** Progress bar fill. */
  bar: string;
  /** Card outline emphasis for the active/complete rows in a stack. */
  ring: string;
}

export const TONES: Record<RunTone, ToneClasses> = {
  idle: {
    pill: "border-border bg-muted text-muted-foreground",
    tile: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    bar: "bg-muted-foreground/35",
    ring: "border-border",
  },
  active: {
    pill: "border-primary/25 bg-primary/10 text-primary",
    tile: "bg-primary/10 text-primary",
    text: "text-primary",
    bar: "bg-primary",
    ring: "border-primary/40 ring-1 ring-primary/10",
  },
  complete: {
    pill: "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    tile: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
    ring: "border-emerald-500/35",
  },
  blocked: {
    pill: "border-amber-500/30 bg-amber-500/12 text-amber-700 dark:text-amber-300",
    tile: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500",
    ring: "border-amber-500/35",
  },
};

export function runTone(tone: RunTone): ToneClasses {
  return TONES[tone];
}

/** The tone of a run, from the two numbers every runner already computes. */
export function toneForProgress(done: number, total: number, complete: boolean): RunTone {
  if (complete) return "complete";
  if (total > 0 && done > 0) return "active";
  return "idle";
}
