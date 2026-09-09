import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

const MIGRATION = read(
  "supabase/migrations/20261009000000_workflow_phase_completion.sql",
);

/*
 * The Workflow Automation Spec's prerequisite: "phase complete" has to become a
 * real, detectable event instead of a status a human toggles by feel. These are
 * path-based, like the rest of the family tests here, because what they guard is
 * the wiring: the SQL rule and the two clients' copy of it must not drift, and
 * the type must exist on every surface that reads a notification.
 */
describe("family: a phase completion is a real, detectable event", () => {
  it("persists completion on project phases and a type on both phase tables", () => {
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS completed_at timestamptz/);
    expect(MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS completed_by uuid/);
    // Both the template and the applied phase carry marker vs actionable.
    expect(MIGRATION).toMatch(/workflow_template_phases_phase_type_check/);
    expect(MIGRATION).toMatch(/project_workflow_phases_phase_type_check/);
    expect(MIGRATION).toMatch(/phase_type IN \('marker', 'actionable'\)/);
  });

  it("recomputes completion with the same rule both clients already agree on", () => {
    // photo -> has a photo, note -> has text, check -> ticked.
    expect(MIGRATION).toMatch(/i\.kind = 'photo' AND i\.photo_id IS NOT NULL/);
    expect(MIGRATION).toMatch(/i\.kind = 'note' AND i\.note_text IS NOT NULL/);
    expect(MIGRATION).toMatch(/i\.kind = 'check' AND i\.completed_at IS NOT NULL/);
    // Every step, not just the required ones, must be done.
    expect(MIGRATION).toMatch(/_item_done = _item_total/);
    // Sign-off still gates completion when required.
    expect(MIGRATION).toMatch(/NOT _needs_signoff OR _signed_off/);
  });

  it("leaves a marker phase with nothing to automate off", () => {
    // No required step -> no completion event, exactly as the spec asks.
    expect(MIGRATION).toMatch(/IF _req_total = 0 THEN/);
    expect(MIGRATION).toMatch(/_complete := false/);
  });

  it("recomputes on item writes and on sign-off", () => {
    expect(MIGRATION).toMatch(/project_workflow_items_recompute_phase/);
    expect(MIGRATION).toMatch(/project_workflow_phases_recompute_completion/);
    expect(MIGRATION).toMatch(
      /AFTER UPDATE OF signed_off_at, requires_signoff ON public\.project_workflow_phases/,
    );
  });

  it("notifies the assignee (or creator) when a phase advances, naming the next phase", () => {
    expect(MIGRATION).toMatch(/notify_phase_advanced/);
    expect(MIGRATION).toMatch(/COALESCE\(_workflow\.assigned_to, _workflow\.created_by\)/);
    // Internal only: no customer-facing link, no Twilio/SMS.
    expect(MIGRATION).toMatch(/\/projects\/' \|\| _workflow\.project_id/);
  });

  it("allows the new type in the database and names it on every reading surface", () => {
    expect(MIGRATION).toMatch(/'workflow_phase_advanced'/);
    expect(read("apps/api/src/domains/notifications/service.ts")).toMatch(
      /\| "workflow_phase_advanced"/,
    );
    expect(read("apps/mobile/src/api/notification-target.ts")).toMatch(
      /\| "workflow_phase_advanced"/,
    );
  });

  it("carries the phase type through every template-to-project copy path", () => {
    // Blueprint apply, the web "start a workflow" flow, and the mobile one all
    // copy the template's marker/actionable distinction; dropping it silently
    // turns a marker into an actionable phase on the applied copy.
    expect(read("apps/api/src/domains/blueprints/service.ts")).toMatch(
      /phase_type: p\.phase_type \?\? "actionable"/,
    );
    expect(read("apps/mobile/src/api/templates.ts")).toMatch(
      /phase_type: phase\.phase_type \?\? "actionable"/,
    );
    expect(read("apps/web/src/features/projects/components/ProjectWorkflows.tsx")).toMatch(
      /phase_type: ph\.phase_type \?\? "actionable"/,
    );
  });
});
