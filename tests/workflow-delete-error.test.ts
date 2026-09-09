import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { friendlyError } from "../apps/web/src/lib/supabase-errors";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/*
 * Spec §6: deleting a workflow the caller is not allowed to delete used to show
 * "Couldn't save that change - check your connection" - a confident, wrong
 * diagnosis of a permission refusal. The root cause is that the workflows panel
 * ran every save through one onError that threw away the real reason.
 */
describe("family: a refused workflow delete says why, not 'check your connection'", () => {
  it("the workflows panel surfaces the real error instead of the blanket message", () => {
    const src = read("apps/web/src/features/projects/components/ProjectWorkflows.tsx");
    expect(src).toMatch(/onError: \(e\) => toast\.error\(friendlyError\(e,/);
    // The old message must be gone - it is the exact text the spec reported.
    expect(src).not.toContain("Couldn't save that change - check your connection");
  });

  it("the authoring-guard refusal is mapped to a sentence, not driver text", () => {
    const shown = friendlyError(
      { message: "Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure." },
      "Could not save",
    );
    expect(shown).toBe("Only an Owner, Admin, or Manager on Pro or Team can do that");
    expect(shown).not.toContain("check your connection");
  });

  it("an RLS refusal still reads as a permission problem, not a network one", () => {
    const shown = friendlyError(
      { message: 'new row violates row-level security policy for table "project_workflows"' },
      "Could not save",
    );
    expect(shown).toContain("permission");
  });
});
