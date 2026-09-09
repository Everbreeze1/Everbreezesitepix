import { attributionText } from "@/features/projects/utils/contributor-attribution";
import type { ProjectContributor } from "@/lib/teams.functions";

/**
 * The "who has been adding photos here" line under "The field, on record".
 *
 * This used to be a "contributors" chip in the project header, beside the crew,
 * and the two read as one staffing list with two names for it: a number next
 * to an avatar stack reads as a headcount no matter what word is attached to
 * it, and the explanation only appeared in a hover panel, which a phone never
 * opens. Managers staffing a job read "3 contributors" as "I'm missing three
 * of the five people I assigned" - the exact confusion reported against the
 * chip.
 *
 * An attribution line reads as a log entry, not a roster row. It sits with the
 * photos it describes, not beside the Assign control, and it carries a caption
 * that says the part the names cannot: who worked here is a record of what
 * happened; who is staffed is the crew.
 */

/**
 * The attribution line and its permanent caption.
 *
 * The caption is always visible, never a hover: touch screens have no hover,
 * and the whole reason this line exists next to the photos is that the
 * distinction it draws did not survive being locked inside a tooltip.
 */
export function ProjectActivityLine({ contributors }: { contributors: ProjectContributor[] }) {
  const text = attributionText(contributors);
  if (!text) return null;

  return (
    <div className="mt-2 space-y-0.5">
      <p className="font-manrope text-xs font-medium text-foreground/90">{text}</p>
      <p className="font-manrope text-[11px] text-muted-foreground">
        Who has been adding photos here - a log of the work, not who is assigned to it.
      </p>
    </div>
  );
}
