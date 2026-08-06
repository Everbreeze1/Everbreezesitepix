import type { Modifier } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

/**
 * Non-component exports for the template builders.
 *
 * These live apart from `builder-ui.tsx` so that file exports components only
 * and keeps working with fast refresh.
 */

/**
 * Rows only ever move up and down here, and letting them drift sideways under
 * the cursor makes the drop target ambiguous. `@dnd-kit/modifiers` ships this
 * exact modifier, but it isn't a dependency of this app and it is one line.
 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * The fix for "I can't tell what's editable": a field that is quiet at rest but
 * grows a border on hover and a real focus ring when you're in it. Used for
 * every in-place edit in the builders so text you can change never reads as
 * static copy.
 */
export const quietFieldClass = cn(
  "w-full rounded-lg border border-transparent bg-transparent px-2 py-1 outline-none transition-colors",
  "placeholder:text-muted-foreground/55",
  "hover:border-border/80 hover:bg-muted/40",
  "focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/15",
);
