import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBlocker,
  fieldSummary,
  groupTemplates,
  templateEditability,
  unresolvedFields,
} from "../apps/mobile/src/api/template-picker-view";
import type { DocumentTemplate, TemplateField } from "../apps/mobile/src/api/pages";

/*
 * Starting a document from a template, on a phone.
 *
 * This was deliberately NOT built for a while, and the reasoning was recorded:
 * a page made from a seeded template is rich HTML, the phone editor refuses to
 * rebuild it, so the document is read-only here the moment it exists.
 *
 * That was the wrong conclusion from a right observation. Read-only still means
 * appendable, shareable and exportable as a PDF, which is the whole of what a
 * handover certificate is for on site - and the alternative was "open a
 * laptop". What was actually wrong was finding out afterwards, so the
 * consequence is now stated before anything is created, measured with the
 * editor's own parser rather than guessed at.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const tpl = (over: Partial<DocumentTemplate> = {}): DocumentTemplate => ({
  id: "t1",
  name: "Handover certificate",
  description: null,
  category: "Field Reports",
  isExample: true,
  fields: [],
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("grouping", () => {
  it("puts the team's own templates first", () => {
    /*
     * A team's saved templates carry no category. They are what somebody is
     * looking for by name, so they lead rather than falling into an "Other"
     * bucket below every built-in.
     */
    const groups = groupTemplates([
      tpl({ id: "a", name: "Roof check", category: "Roofing" }),
      tpl({ id: "b", name: "Our snag list", category: null, isExample: false }),
      tpl({ id: "c", name: "Daily record", category: "Field Reports" }),
    ]);
    expect(groups[0].category).toBe("Your team's");
    expect(groups[0].templates.map((t) => t.name)).toEqual(["Our snag list"]);
    expect(groups.slice(1).map((g) => g.category)).toEqual(["Field Reports", "Roofing"]);
  });

  it("sorts within a group by name, so the list is scannable", () => {
    const groups = groupTemplates([
      tpl({ id: "a", name: "Zinc flashing" }),
      tpl({ id: "b", name: "Apron detail" }),
    ]);
    expect(groups[0].templates.map((t) => t.name)).toEqual(["Apron detail", "Zinc flashing"]);
  });

  it("gives a built-in with no category somewhere to live", () => {
    const groups = groupTemplates([tpl({ category: null })]);
    expect(groups[0].category).toBe("Built-in");
  });
});

describe("what the person still has to type", () => {
  const fields: TemplateField[] = [
    { token: "{{site_address}}", label: "Site address", value: "20 Charlcote Crescent" },
    { token: "{{weather}}", label: "Weather", value: null },
    { token: "{{client_ref}}", label: "Client reference", value: "   " },
  ];

  it("asks only for the ones the job could not answer", () => {
    /*
     * Showing a resolved token as an empty box invites somebody to retype the
     * site address that was already correct - and then to get it wrong.
     */
    expect(unresolvedFields(fields).map((f) => f.label)).toEqual(["Weather", "Client reference"]);
  });

  it("says what the job filled in, in one line", () => {
    expect(fieldSummary(fields)).toBe("1 filled in from this job, 2 to type.");
    expect(fieldSummary([])).toBe("This template has nothing to fill in.");
    expect(fieldSummary([fields[0]])).toBe("All 1 filled in from this job.");
    expect(fieldSummary([fields[1]])).toBe("1 to fill in.");
  });
});

describe("only the name is required", () => {
  it("blocks on an empty name", () => {
    expect(createBlocker("   ")).toBe("Give this document a name.");
    expect(createBlocker("Handover")).toBeNull();
  });

  it("does not block on unanswered merge tokens", () => {
    /*
     * Deliberate. The web leaves an unanswered token as its literal
     * placeholder, and a technician who does not know the client's reference
     * should still be able to file the certificate for somebody to finish.
     * Refusing here would make the phone stricter than the desk for a reason
     * nobody could see.
     */
    expect(createBlocker("Handover")).toBeNull();
  });
});

describe("the editability warning is measured, not guessed", () => {
  it("says a rich body will be read-only", () => {
    const rich = "<h1>Certificate</h1><table><tr><td>Cell</td></tr></table>";
    const verdict = templateEditability(rich);
    expect(verdict.editable).toBe(false);
    if (!verdict.editable) {
      expect(verdict.because).toContain("read-only");
      // The consolation has to be in the same breath, because it is the reason
      // the feature is worth having at all.
      expect(verdict.because).toContain("add to the end");
      expect(verdict.because).toContain("PDF");
    }
  });

  it("says nothing when the body is plain enough to edit", () => {
    expect(templateEditability("<p>Notes</p><p>More notes</p>").editable).toBe(true);
  });

  it("uses the editor's own parser rather than a second opinion", () => {
    /*
     * The guard that matters. A private list of "rich" tags here would drift
     * from the editor's, and the screen would promise editing the editor then
     * refuses - which is the failure this warning exists to prevent.
     */
    const view = read("apps/mobile/src/api/template-picker-view.ts");
    expect(view).toContain('import { parsePage } from "./doc-blocks"');
    expect(view).toContain("parsePage(html");
  });
});

describe("the screen", () => {
  const sheet = () => read("apps/mobile/src/ui/TemplatePickerSheet.tsx");

  it("warns before creating, not after", () => {
    const s = sheet();
    const warning = s.indexOf("editability.because");
    const button = s.indexOf('label={create.isPending ? "Creating"');
    expect(warning).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(-1);
    expect(warning).toBeLessThan(button);
  });

  it("guards the double tap itself, because the server does not", () => {
    /*
     * `createPageFromTemplate` is registered `authed(...)` with no
     * `{ idempotent: true }`, so a key would be inert and a second press would
     * file a second certificate. Checked against the registry, not assumed.
     */
    const registry = read("apps/api/src/domains/rpc/registry.ts");
    const at = registry.indexOf("createPageFromTemplate: authed(");
    expect(at).toBeGreaterThan(-1);
    expect(registry.slice(at, at + 260)).not.toContain("idempotent: true");
    expect(sheet()).toContain("disabled={create.isPending || Boolean(blocker)}");
  });

  it("is reachable from the documents header", () => {
    const docs = read("apps/mobile/app/(app)/project/[id]/documents.tsx").replace(/\s+/g, " ");
    expect(docs).toContain('accessibilityLabel="Start from a template"');
    expect(docs).toContain("<TemplatePickerSheet");
  });

  it("lands on the document it just made", () => {
    // Creating something and being left on the list is the shape of bug where
    // people press the button twice.
    expect(sheet()).toContain("onCreated");
    expect(read("apps/mobile/app/(app)/project/[id]/documents.tsx")).toContain(
      'router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } })',
    );
  });
});
