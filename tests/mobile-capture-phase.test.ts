import { describe, expect, it } from "vitest";
import {
  phaseAtShutter,
  savedMessage,
  setPhaseForAll,
  sharedPhase,
  shotPhase,
  type PhasedShot,
} from "../apps/mobile/src/lib/capture-batch";

/*
 * Before/After is decided per shot, at the shutter.
 *
 * Jon took a Before shot, flipped the toggle to After, took an After shot,
 * and both saved under one phase: the batch read the toggle at Save time.
 * These tests replay that sequence through the same rules the camera uses.
 */

type TestShot = PhasedShot & { key: string };

/** The camera's sequence: every shutter press records the toggle as it is then. */
function shoot(sequence: { mode: string; toggle: "before" | "after" | "untagged" }[]) {
  const shots: TestShot[] = [];
  for (const [i, step] of sequence.entries()) {
    shots.push({ key: `shot-${i}`, phase: phaseAtShutter(step.mode, step.toggle) });
  }
  return shots;
}

describe("phase per shot", () => {
  it("keeps a Before and an After apart when the toggle flips between them", () => {
    const shots = shoot([
      { mode: "before-after", toggle: "before" },
      { mode: "before-after", toggle: "after" },
    ]);
    // Whatever the toggle says by the time Save is pressed does not matter.
    expect(shots.map(shotPhase)).toEqual(["before", "after"]);
  });

  it("keeps each shot's phase through a longer mixed run", () => {
    const shots = shoot([
      { mode: "before-after", toggle: "before" },
      { mode: "before-after", toggle: "before" },
      { mode: "before-after", toggle: "untagged" },
      { mode: "before-after", toggle: "after" },
      { mode: "before-after", toggle: "after" },
    ]);
    expect(shots.map(shotPhase)).toEqual(["before", "before", "untagged", "after", "after"]);
    expect(sharedPhase(shots)).toBeNull();
  });

  it("tags nothing outside Before/After mode, whatever the toggle last said", () => {
    expect(phaseAtShutter("photo", "after")).toBe("untagged");
    expect(phaseAtShutter("measure", "before")).toBe("untagged");
    expect(phaseAtShutter("untagged", "before")).toBe("untagged");
  });

  it("never gives a scan a before/after phase", () => {
    expect(phaseAtShutter("before-after", "before", true)).toBe("untagged");
    expect(shotPhase({ phase: "after", scan: true })).toBe("untagged");
  });

  it("reads a shot with no recorded phase as untagged", () => {
    expect(shotPhase({})).toBe("untagged");
  });
});

describe("review's Set all row", () => {
  it("sets every photo but leaves scans alone", () => {
    const shots: TestShot[] = [
      { key: "a", phase: "before" },
      { key: "b", phase: "after" },
      { key: "c", scan: true },
    ];
    const next = setPhaseForAll(shots, "after");
    expect(next.map(shotPhase)).toEqual(["after", "after", "untagged"]);
    expect(next[2]).toBe(shots[2]);
    expect(sharedPhase(next)).toBe("after");
  });

  it("reports no shared phase for an empty or scan-only batch", () => {
    expect(sharedPhase([])).toBeNull();
    expect(sharedPhase([{ scan: true }])).toBeNull();
  });
});

describe("saved toast", () => {
  it("counts photos", () => {
    expect(savedMessage(1)).toBe("1 photo saved");
    expect(savedMessage(5)).toBe("5 photos saved");
  });
});
