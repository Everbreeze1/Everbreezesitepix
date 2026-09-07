import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("template, checklist and workflow authoring gate", () => {
  const migration = read(
    "supabase/migrations/20261008000000_template_authoring_and_feedback_subject.sql",
  );

  it("enforces Owner/Admin/Manager plus Pro/Team in Postgres", () => {
    expect(migration).toContain("tm.role IN ('owner', 'admin', 'manager')");
    expect(migration).toContain("t.plan IN ('pro', 'team')");
    expect(migration).toContain("project_checklists_authoring_guard");
    expect(migration).toContain("project_checklist_items_authoring_guard");
    expect(migration).toContain("project_workflows_authoring_guard");
    expect(migration).toContain("project_workflow_phases_authoring_guard");
    expect(migration).toContain("project_workflow_items_authoring_guard");
  });

  it("keeps service-role jobs outside the user authoring guard", () => {
    expect(migration).toMatch(/IF auth\.uid\(\) IS NULL THEN/);
  });

  it("gates direct checklist and workflow template routes, not only the Templates hub", () => {
    for (const path of [
      "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx",
      "apps/web/src/features/settings/pages/WorkflowTemplatesPage.tsx",
    ]) {
      const src = read(path);
      expect(src).toContain("useTemplateAuthoringAccess");
      expect(src).toContain("!access.canAuthor");
    }
  });
});

describe("bug report subject", () => {
  const migration = read(
    "supabase/migrations/20261008000000_template_authoring_and_feedback_subject.sql",
  );
  const page = read("apps/web/src/features/settings/pages/ReportIssuePage.tsx");
  const admin = read("apps/web/src/features/admin/pages/AdminFeedbackPage.tsx");
  const api = read("apps/api/src/domains/admin/feedback.ts");

  it("stores a bounded subject and puts it before the optional project selector", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS subject text");
    expect(migration).toContain("char_length(subject) <= 160");
    expect(page.indexOf('id="feedback-subject"')).toBeGreaterThan(-1);
    expect(page.indexOf('id="feedback-subject"')).toBeLessThan(page.indexOf('id="feedback-project"'));
    expect(page).toContain('kind === "bug" && !subject.trim()');
  });

  it("surfaces the subject to admins and includes it in triage search", () => {
    expect(admin).toContain("report.subject");
    expect(api).toContain("subject.ilike.${like}");
  });

  it("carries the subject onto the phone: the queue shows it and the phone files one", () => {
    const rules = read("apps/mobile/src/api/feedback-view.ts");
    const submit = read("apps/mobile/src/api/feedback.ts");
    const queueType = read("apps/mobile/src/api/admin-view.ts");
    const queue = read("apps/mobile/app/(app)/admin.tsx");
    const form = read("apps/mobile/app/(app)/report-issue.tsx");

    expect(rules).toContain("MAX_SUBJECT = 160");
    expect(rules).toContain("export function subjectError(");
    expect(rules).toContain("export function cleanSubject(");
    // The queue card leads with the subject, the way the web console does.
    expect(queueType).toContain("subject: string | null;");
    expect(queue).toContain("report.subject");
    // Bugs require it; ideas and praise are filed without one.
    expect(form).toContain("subjectError(kind, subject)");
    expect(form).toContain("cleanSubject(kind, subject)");
    // It rides the modern-columns insert and stays out of the legacy retry,
    // which exists to drop exactly those columns.
    expect(submit).toMatch(/\.\.\.\(input\.subject \? \{ subject: input\.subject \} : \{\}\)/);
  });
});
