import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addRecent,
  EMPTY_NOTE,
  metaForNewShot,
  noteIsActive,
  noteSummary,
  patchRecent,
  phaseAtShutter,
  pillChanged,
  pillOf,
  queuedMetaPatch,
  RECENT_MAX,
  SCAN_TAG,
  shotPhase,
  uploadedMetaPatch,
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
    // Whatever the toggle says later does not matter.
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

describe("retagging one saved shot", () => {
  type Recent = {
    id: string;
    phase: "before" | "after" | "untagged";
    caption: string;
    tags: string[];
  };
  const three: Recent[] = [
    { id: "c", phase: "after", caption: "", tags: [] },
    { id: "b", phase: "before", caption: "", tags: [] },
    { id: "a", phase: "before", caption: "", tags: [] },
  ];

  it("changes that shot only, never the rest", () => {
    // The old review screen's row relabelled every photo the same (Jon, 2026-09-29).
    const next = patchRecent(three, "b", { phase: "after" });
    expect(next.map((shot) => shot.phase)).toEqual(["after", "after", "before"]);
    expect(next[0]).toBe(three[0]);
    expect(next[2]).toBe(three[2]);
  });

  it("keeps the newest shot first, and a bounded number of them", () => {
    let list: Recent[] = [];
    for (let i = 0; i < RECENT_MAX + 5; i += 1) {
      list = addRecent(list, { id: `s${i}`, phase: "untagged", caption: "", tags: [] });
    }
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe(`s${RECENT_MAX + 4}`);
  });

  it("knows when a retag has to redraw the picture's pill", () => {
    expect(pillChanged({ phase: "before" }, { phase: "after" })).toBe(true);
    expect(pillChanged({ phase: "untagged" }, { phase: "before" })).toBe(true);
    expect(pillChanged({ phase: "after" }, { phase: "after" })).toBe(false);
    // A scan never has a pill, whatever it is set to.
    expect(pillChanged({ phase: "untagged", scan: true }, { phase: "after", scan: true })).toBe(
      false,
    );
    expect(pillOf({ phase: "after", scan: true })).toBeNull();
  });

  it("writes the queued upload's fields, leaving an empty note to the dated default", () => {
    expect(
      queuedMetaPatch({ phase: "before", caption: "  Attic unit  ", tags: ["hvac", "hvac"] }),
    ).toEqual({
      phase: "before",
      caption: "Attic unit",
      tags: ["hvac"],
    });
    expect(queuedMetaPatch({ phase: "after", caption: " ", tags: [] }).caption).toBeUndefined();
  });

  it("patches a landed photo with every column it sets, untagged as null", () => {
    expect(uploadedMetaPatch({ phase: "untagged", caption: "", tags: ["roof"] })).toEqual({
      phase: null,
      caption: null,
      tags: ["roof"],
    });
    expect(uploadedMetaPatch({ phase: "after", caption: "Done", tags: [] })).toEqual({
      phase: "after",
      caption: "Done",
      tags: [],
    });
  });
});

describe("the camera's note for the next shots", () => {
  it("is off until a caption or a tag is set", () => {
    expect(noteIsActive(EMPTY_NOTE)).toBe(false);
    expect(noteIsActive({ caption: "  ", tags: [] })).toBe(false);
    expect(noteIsActive({ caption: "Leak", tags: [] })).toBe(true);
    expect(noteIsActive({ caption: "", tags: ["roof"] })).toBe(true);
  });

  it("says what is on, briefly, for the camera pill", () => {
    expect(noteSummary(EMPTY_NOTE)).toBeNull();
    expect(noteSummary({ caption: "", tags: ["roof"] })).toBe("roof");
    expect(noteSummary({ caption: "", tags: ["roof", "gutter"] })).toBe("2 tags");
    expect(noteSummary({ caption: "Leak", tags: ["roof"] })).toBe("Leak +1 tag");
    expect(noteSummary({ caption: "Water stain above the kitchen window", tags: [] })).toBe(
      "Water stain above...",
    );
  });

  it("gives each new shot its own copy, with the scan tag on a scan", () => {
    const note = { caption: " Kitchen ", tags: ["interior"] };
    const photo = metaForNewShot(note, false);
    expect(photo).toEqual({ caption: "Kitchen", tags: ["interior"] });
    expect(photo.tags).not.toBe(note.tags);
    expect(metaForNewShot(note, true).tags).toEqual(["interior", SCAN_TAG]);
  });
});

describe("the camera saves as it shoots", () => {
  const camera = readFileSync(
    resolve(__dirname, "../apps/mobile/app/(app)/project/[id]/capture.tsx"),
    "utf8",
  );

  it("queues each shot when it is taken, with no review or Save step", () => {
    expect(camera).toContain('kind: "photo_upload"');
    expect(camera).not.toMatch(/setReviewing|SET ALL PHOTOS TO|setPhaseForAll/);
    expect(camera).not.toMatch(/Save \{shots\.length\}/);
  });

  it("keeps the library, the note and the mic on the camera", () => {
    expect(camera).toContain('accessibilityLabel="Add from library"');
    expect(camera).toContain("<PhotoNoteEditor");
    expect(camera).toContain("openVoiceNote");
  });

  it("opens one photo's editor from the last shot, with no strip of photos", () => {
    // Several photos side by side is the walkthrough's screen only (Jon, 2026-09-29).
    expect(camera).not.toMatch(/strip=\{/);
    expect(camera).toMatch(/photoUri=\{panelShot\.thumb \?\? panelShot\.source\}/);
    expect(camera).toContain('setPanel({ kind: "shot", id: lastShot.id, start: "voice" })');
  });

  it("retags a photo that has already gone by its own row, not the batch", () => {
    expect(camera).toContain("updateQueuedPayload(id");
    expect(camera).toContain('kind: "captured_photo_patch"');
  });
});
