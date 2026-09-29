import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WALKTHROUGH_DELETE_WARNING,
  walkthroughEditPatch,
} from "../apps/mobile/src/api/walkthrough-list-view";

/*
 * Editing and deleting a walkthrough from the phone, as the web detail page
 * does: the row's own title and notes (`summary_markdown`), and a delete that
 * confirms first and says what survives.
 */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("walkthroughEditPatch", () => {
  it("trims the title and keeps the notes as written", () => {
    expect(walkthroughEditPatch("  Roof walk  ", "## Findings\n- leak")).toEqual({
      ok: true,
      patch: { title: "Roof walk", summary_markdown: "## Findings\n- leak" },
    });
  });

  it("stores empty notes as null", () => {
    expect(walkthroughEditPatch("Roof walk", "   ")).toEqual({
      ok: true,
      patch: { title: "Roof walk", summary_markdown: null },
    });
  });

  it("refuses a blank or overlong title", () => {
    expect(walkthroughEditPatch("  ", "x").ok).toBe(false);
    expect(walkthroughEditPatch("x".repeat(201), "").ok).toBe(false);
  });
});

describe("the walkthrough screen", () => {
  const screen = read("apps/mobile/app/(app)/walkthrough/[id].tsx");
  const api = read("apps/mobile/src/api/walkthroughs.ts");

  it("writes the same columns the web does", () => {
    expect(api).toMatch(/from\("walkthroughs"\)\s*\.update\(patch as never\)/);
    expect(api).toMatch(/from\("walkthroughs"\)\.delete\(\)\.eq\("id", walkthroughId\)/);
  });

  it("confirms before deleting, and says the photos and summary stay", () => {
    expect(WALKTHROUGH_DELETE_WARNING).toMatch(/summary and your photos are not affected/);
    expect(screen).toMatch(/Alert\.alert\("Delete this walkthrough\?", WALKTHROUGH_DELETE_WARNING/);
    expect(screen).toMatch(/style: "destructive"/);
  });

  it("leaves the screen after a delete, with a way back even from a deep link", () => {
    expect(screen).toMatch(
      /goBack\(projectId \? `\/project\/\$\{projectId\}\/walkthroughs` : "\/"\)/,
    );
  });
});
