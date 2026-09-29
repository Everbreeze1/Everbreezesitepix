import type { PhotoPhase } from "../api/photos";

/**
 * The before/after rules for a camera batch, free of React and native imports
 * so they can be tested directly.
 *
 * WHY PER SHOT
 *
 * The phase used to be one value for the whole batch, read when Save was
 * pressed. A technician who took a Before shot, flipped the toggle to After
 * and took an After shot then saved both under whichever side the toggle was
 * left on, so a before/after pair came out as two Befores (Jon, 2026-09-29).
 * Each shot now carries the phase that was selected at the moment its shutter
 * fired, and Save reads the shot, never the toggle.
 */

/** What a batch shot needs for these rules. */
export type PhasedShot = { phase?: PhotoPhase; scan?: boolean };

/**
 * The phase a new shot is stamped with, read when the shutter is pressed.
 *
 * Only Before/After mode tags a shot; every other mode is untagged whatever
 * the toggle last said. A scan never carries a before/after pill.
 */
export function phaseAtShutter(mode: string, selected: PhotoPhase, scan = false): PhotoPhase {
  if (scan) return "untagged";
  return mode === "before-after" ? selected : "untagged";
}

/** The phase a shot is saved with. Rows from before this field read as untagged. */
export function shotPhase(shot: PhasedShot): PhotoPhase {
  if (shot.scan) return "untagged";
  return shot.phase ?? "untagged";
}

/** Every photo in the batch set to one phase, from review's "Set all" row. Scans stay untagged. */
export function setPhaseForAll<T extends PhasedShot>(shots: T[], phase: PhotoPhase): T[] {
  return shots.map((shot) => (shot.scan ? shot : { ...shot, phase }));
}

/**
 * The phase every non-scan photo shares, or null when they differ (or there
 * are none), so review highlights a "Set all" option only when it is true.
 */
export function sharedPhase(shots: PhasedShot[]): PhotoPhase | null {
  const phases = new Set(shots.filter((shot) => !shot.scan).map(shotPhase));
  return phases.size === 1 ? [...phases][0] : null;
}

/** "1 photo saved", "5 photos saved". */
export function savedMessage(count: number): string {
  return `${count} photo${count === 1 ? "" : "s"} saved`;
}
