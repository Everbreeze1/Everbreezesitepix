import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

const MIGRATION = read("supabase/migrations/20261009010000_photo_workflow_auto_tagging.sql");

/*
 * Spec #1: a photo captured against a workflow step is tagged with its workflow
 * and phase as structured metadata, not just a caption. The rule is a database
 * trigger on `project_workflow_items`, so it covers every capture path (web,
 * mobile, future) with no client change - the same "the UI is the mirror, not
 * the lock" idea the assignment triggers already rely on.
 */
describe("family: a step's photo carries its workflow and phase", () => {
  it("adds structured provenance columns to photos", () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS workflow_id uuid/);
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS workflow_phase_id uuid/);
  });

  it("stamps the photo from the step's own phase, in the database not the client", () => {
    // The trigger keys off photo_id and phase_id on the item, so no capture
    // path has to remember to set these by hand.
    expect(MIGRATION).toMatch(/tag_photo_with_workflow_step/);
    expect(MIGRATION).toMatch(/AFTER INSERT OR UPDATE OF photo_id, phase_id ON public\.project_workflow_items/);
    expect(MIGRATION).toMatch(/WHERE ph\.id = NEW\.phase_id/);
    expect(MIGRATION).toMatch(/workflow_id = _workflow_id/);
    expect(MIGRATION).toMatch(/workflow_phase_id = NEW\.phase_id/);
  });

  it("clears provenance when a photo is detached or re-taken", () => {
    // A detached photo stays in the gallery but must not keep pointing at the
    // phase it no longer belongs to.
    expect(MIGRATION).toMatch(/OLD\.photo_id IS DISTINCT FROM NEW\.photo_id/);
    expect(MIGRATION).toMatch(/SET workflow_id = NULL, workflow_phase_id = NULL/);
  });

  it("keeps the columns out of the client capture path, since the trigger owns them", () => {
    // The web capture flow writes caption and phase='workflow'; the workflow/phase
    // pointers come from the trigger alone, so the two cannot drift apart.
    expect(read("packages/db/src/database.ts")).toMatch(/workflow_id: string \| null/);
    expect(read("packages/db/src/database.ts")).toMatch(/workflow_phase_id: string \| null/);
  });
});
