import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SHOW_WORKFLOWS } from "../packages/shared/src/index";
import { HELP_CATEGORIES } from "../packages/shared/src/help-guides";
import { BLUEPRINT_STARTERS } from "../apps/web/src/features/settings/components/blueprint-starters";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * Workflows hidden everywhere.
 *
 * "I dont have a use for it for a photo management site." The owner chose to
 * remove it: nothing offers, lists or creates a workflow, but the data and the
 * code stay so it can come back with one flag. These check both halves.
 */
describe("SHOW_WORKFLOWS", () => {
  it("is off", () => {
    expect(SHOW_WORKFLOWS).toBe(false);
  });

  it("drops the Workflows Knowledge Base section", () => {
    expect(HELP_CATEGORIES.some((c) => c.id === "workflows")).toBe(false);
    expect(read("packages/shared/src/help-guides.ts")).toContain('id: "workflows"');
  });

  it("starter blueprints no longer install a workflow", () => {
    for (const s of BLUEPRINT_STARTERS) {
      expect(s.pieces.some((p) => p.kind === "workflow")).toBe(false);
    }
  });

  it("hides the project tab and stage strip, and redirects old links", () => {
    const detail = read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx");
    expect(detail).toMatch(/\{SHOW_WORKFLOWS && \(\s*<ProjectWorkflowStrip/);
    expect(detail).toMatch(/search\.panel === "workflows" && !SHOW_WORKFLOWS/);
    expect(read("apps/web/src/routes/_app.settings.workflows.tsx")).toMatch(
      /if \(!SHOW_WORKFLOWS\) throw redirect/,
    );
    expect(read("apps/web/src/routes/_app.projects.$projectId_.workflows.$workflowId.tsx")).toMatch(
      /if \(!SHOW_WORKFLOWS\)\s*throw redirect/,
    );
  });

  it("keeps the blueprint editor and Templates hub from offering one", () => {
    expect(read("apps/web/src/features/settings/components/BlueprintLibraryContent.tsx")).toMatch(
      /\{SHOW_WORKFLOWS && \(\s*<div>\s*\{\/\* Workflow phases \*\/\}/,
    );
    expect(read("apps/web/src/features/settings/pages/TemplatesPage.tsx")).toMatch(
      /!SHOW_WORKFLOWS && requestedTab === "workflows"/,
    );
  });

  it("applying a blueprint skips workflow runs, and no stalled alerts go out", () => {
    const apply = read("apps/api/src/domains/blueprints/service.ts");
    expect(apply.match(/if \(!SHOW_WORKFLOWS\) continue;/g)?.length).toBe(2);
    expect(read("apps/api/src/domains/hooks/workflow-escalation.ts")).toMatch(
      /if \(!SHOW_WORKFLOWS\) return jsonOk/,
    );
  });
});
