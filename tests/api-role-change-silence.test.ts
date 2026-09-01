import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A role change that changes nothing must not answer 200.
 *
 * Found by driving the phone. Tapping a role in the picker closed the sheet,
 * sent `updateMemberRole`, and the API answered HTTP 200 with no error and
 * wrote a clean audit row - while `team_members.role` stayed exactly as it was.
 * The roster then refetched and redrew the OLD role, so the screen looked like
 * it had ignored the tap. Verified three times against the deployed API, on the
 * top plan, as the workspace owner, with no trigger on the table.
 *
 * The reason it can happen at all: PostgREST does not treat "matched no rows"
 * as an error on UPDATE. `const { error } = await ...update().eq()` is
 * therefore blind to the one failure that matters here, and every caller of
 * that shape has the same hole.
 *
 * This does not diagnose why the filter matched nothing. It makes it
 * impossible for that to be reported as success, which is the part an admin
 * revoking somebody's access cannot afford to get wrong.
 */

const service = () =>
  readFileSync(join(process.cwd(), "apps/api/src/domains/teams/service.ts"), "utf8");

function updateMemberRoleBody(src: string): string {
  const start = src.indexOf("export async function updateMemberRoleService");
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("changing a member's role", () => {
  it("asks for the row back, so a no-op cannot look like a success", () => {
    const body = updateMemberRoleBody(service());
    expect(body).toContain('.select("id, role")');
  });

  it("fails when nothing was written", () => {
    const body = updateMemberRoleBody(service());
    expect(body).toMatch(/updated\b/);
    expect(body).toContain("did not save");
  });

  it("does not report that failure as a server fault", () => {
    /*
     * 409, not 500. Nothing crashed: the row the caller named was not there to
     * change, which is a conflict with what their screen believes, and the
     * honest instruction is to reload.
     */
    expect(updateMemberRoleBody(service())).toContain("status: 409");
  });

  it("still throws on a real database error", () => {
    // The original guard has to survive alongside the new one.
    expect(updateMemberRoleBody(service())).toContain("if (error) throw new Error(error.message)");
  });
});

describe("withdrawing an outside firm's access", () => {
  /*
   * The same shape, on the path where silence costs the most. `revokeSubcontractor`
   * is what takes away a login to a customer's jobsite photographs; reporting
   * `{ ok: true }` for an update that stamped nothing tells an admin the access
   * is gone while the link still opens.
   *
   * Precautionary: the row is read immediately above the update, so it should
   * always match. `updateMemberRole` read its row first too.
   */
  const subs = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/subcontractors/service.ts"), "utf8");

  it("confirms the revoke stamped a row", () => {
    const s = subs();
    expect(s).toContain('.select("id")');
    expect(s).toContain("was not withdrawn");
  });

  it("does not answer ok when nothing was written", () => {
    /*
     * The `{ ok: true }` has to sit AFTER the emptiness check, or the guard is
     * decorative: the caller reads success either way.
     */
    const s = subs();
    const okAt = s.indexOf("return { ok: true };", s.indexOf("revoked_at"));
    const guardAt = s.indexOf("was not withdrawn");
    expect(guardAt).toBeGreaterThan(-1);
    expect(okAt).toBeGreaterThan(guardAt);
  });
});
