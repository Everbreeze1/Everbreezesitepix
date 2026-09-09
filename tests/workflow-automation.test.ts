import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

const QUEUE_MIGRATION = read("supabase/migrations/20261009020000_workflow_automation_queue.sql");
const ISSUES_MIGRATION = read("supabase/migrations/20261009030000_workflow_issues_escalation.sql");

/*
 * Spec #5/#8 (report automation) and #2/#9 (issues + escalation). These are
 * path-based, like the rest of the family tests: the enqueue is in the database
 * because the completing write comes straight from the browser, and the drain is
 * a cron hook because the report/AI work needs the API's key.
 */
describe("family: workflow completion produces a client-ready report", () => {
  it("flags generated reports as auto-added and ready to send", () => {
    expect(QUEUE_MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS added_automatically boolean/);
    expect(QUEUE_MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS ready_to_send boolean/);
  });

  it("enqueues a report when a workflow completes, not when it is created", () => {
    expect(QUEUE_MIGRATION).toMatch(/enqueue_workflow_report/);
    expect(QUEUE_MIGRATION).toMatch(
      /NEW\.completed_at IS NOT NULL AND OLD\.completed_at IS NULL/,
    );
    expect(QUEUE_MIGRATION).toMatch(/'workflow_report'/);
  });

  it("schedules the drain that runs the report", () => {
    expect(QUEUE_MIGRATION).toMatch(/cron\.schedule\(\s*'workflow-automation'/);
    expect(QUEUE_MIGRATION).toMatch(/\/v1\/hooks\/workflow-automation/);
  });

  it("the drain reuses the existing report engine and flags the result", () => {
    const hook = read("apps/api/src/domains/hooks/workflow-automation.ts");
    expect(hook).toMatch(/generateComprehensiveReportService/);
    expect(hook).toMatch(/added_automatically: true, ready_to_send: true/);
  });

  it("drafts a per-phase report when a phase completes (#4)", () => {
    expect(QUEUE_MIGRATION).toMatch(/enqueue_phase_report/);
    expect(QUEUE_MIGRATION).toMatch(/'phase_report'/);
    const hook = read("apps/api/src/domains/hooks/workflow-automation.ts");
    expect(hook).toMatch(/generateProjectPageService/);
    // The phase's photos come off the Phase 2 provenance column.
    expect(hook).toMatch(/workflow_phase_id/);
  });
});

describe("family: AI issues and escalation", () => {
  it("creates an issues table with a human confirm/dismiss status", () => {
    expect(ISSUES_MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.issues/);
    expect(ISSUES_MIGRATION).toMatch(/status IN \('open', 'confirmed', 'dismissed'\)/);
  });

  it("keeps the defect taxonomy configurable, not hardcoded", () => {
    expect(ISSUES_MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS public\.defect_taxonomies/);
    expect(ISSUES_MIGRATION).toMatch(/terms text\[\]/);
  });

  it("filters AI defects against the configured taxonomy before raising issues (#2)", () => {
    const hook = read("apps/api/src/domains/hooks/workflow-automation.ts");
    expect(hook).toMatch(/defect_taxonomies/);
    expect(hook).toMatch(/terms\.some/);
  });

  it("gates the issue scan to Team plan and the escalation window is per-template", () => {
    expect(ISSUES_MIGRATION).toMatch(/NOT public\.is_team_plan\(_owner\)/);
    expect(ISSUES_MIGRATION).toMatch(/ADD COLUMN IF NOT EXISTS stall_window_hours integer/);
  });

  it("schedules the escalation sweep", () => {
    expect(ISSUES_MIGRATION).toMatch(/cron\.schedule\(\s*'workflow-escalation'/);
    expect(ISSUES_MIGRATION).toMatch(/\/v1\/hooks\/workflow-escalation/);
  });

  it("the new types are named in the database and on every reading surface", () => {
    expect(ISSUES_MIGRATION).toMatch(/'workflow_stalled'/);
    expect(read("apps/api/src/domains/notifications/service.ts")).toMatch(/\| "workflow_stalled"/);
    expect(read("apps/mobile/src/api/notification-target.ts")).toMatch(/\| "workflow_stalled"/);
  });

  it("registers both hooks on the server", () => {
    const server = read("apps/api/src/server.ts");
    expect(server).toMatch(/\/v1\/hooks\/workflow-automation/);
    expect(server).toMatch(/\/v1\/hooks\/workflow-escalation/);
  });
});
