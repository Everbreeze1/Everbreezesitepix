import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SERVICE = "apps/api/src/domains/subcontractors/service.ts";
const MIGRATION = "supabase/migrations/20260910000000_subcontractor_access.sql";

/*
 * Subcontractor access is sold as "does NOT count against the paid user seats".
 * That promise is not enforced by a rule anywhere - it holds because
 * subcontractors live in their own table and `effectiveMemberLimit` counts
 * `team_members`. Which means one careless line in the service, filing a
 * subcontractor as a member "so it shows up in the roster", silently starts
 * charging for every one of them.
 *
 * These are source assertions rather than behavioural tests because the
 * behaviour lives in Postgres RLS, which cannot run here (no local database).
 * They guard the properties whose violation would be silent.
 */
describe("family: a subcontractor never consumes a paid seat", () => {
  it("the service never writes to team_members", () => {
    const src = read(SERVICE);
    // Reading it is fine and necessary - the invite path checks whether the
    // address is already staff. Writing is what would take a seat.
    expect(src).not.toMatch(/from\("team_members"[\s\S]{0,200}?\.(insert|upsert)\(/);
  });

  it("the seat cap is never consulted, only explained", () => {
    const src = read(SERVICE);
    // The doc comment names `effectiveMemberLimit` deliberately - explaining
    // why this table exists is the point. Calling it, importing it, or reading
    // `member_limit` off a row is what would mean a subcontractor is being
    // measured against the seat count.
    expect(src).not.toMatch(/effectiveMemberLimit\s*\(/);
    expect(src).not.toMatch(/import[\s\S]{0,200}?(effectiveMemberLimit|PLAN_MEMBER_CAP)/);
    expect(src).not.toMatch(/["']member_limit["']|\.member_limit\b/);
  });

  it("the migration creates its own tables rather than extending team_members", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.subcontractors\b/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.subcontractor_projects\b/);
    expect(sql).not.toMatch(/ALTER TABLE public\.team_members/i);
  });
});

describe("family: the grant is gated, scoped, and revocable", () => {
  it("managing subcontractors requires the Team plan and an admin", () => {
    const src = read(SERVICE);
    expect(src).toMatch(/plan\.isTeam/);
    expect(src).toMatch(/Subcontractor access requires the Team plan\./);
    expect(src).toMatch(/role !== "owner" && role !== "admin"/);
  });

  it("the reach check demands accepted, unrevoked, and still on Team", () => {
    const sql = read(MIGRATION);
    const fn = sql.slice(sql.indexOf("subcontractor_can_reach_project(_user_id"));
    expect(fn).toMatch(/s\.accepted_at IS NOT NULL/);
    expect(fn).toMatch(/s\.revoked_at IS NULL/);
    // A downgrade must end access without anyone running a cleanup job.
    expect(fn).toMatch(/t\.plan = 'team'/);
  });

  it("revoking is a soft delete, so the audit trail survives", () => {
    const src = read(SERVICE);
    expect(src).toMatch(/revoked_at: new Date\(\)\.toISOString\(\)/);
    expect(src).not.toMatch(/from\("subcontractors"[\s\S]{0,120}?\.delete\(\)/);
  });

  it("project ids are checked against the caller's own team", () => {
    const src = read(SERVICE);
    expect(src).toMatch(/assertProjectsBelongToTeam/);
    expect(src).toMatch(/That project is not part of your team\./);
    // Both write paths must run it, not just the invite.
    const calls = src.match(/await assertProjectsBelongToTeam\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("family: subcontractor RLS grants photos and nothing else", () => {
  const sql = read(MIGRATION);

  it("uploads are forced to carry the uploader's own id", () => {
    // Without this a subcontractor can attribute a photo to a member of staff,
    // which defeats the reason this is a login rather than an upload link.
    const insert = sql.slice(sql.indexOf('"Subcontractors upload to assigned projects"'));
    expect(insert).toMatch(/uploaded_by = auth\.uid\(\)/);
  });

  it("gives them no way to delete site evidence", () => {
    expect(sql).not.toMatch(/CREATE POLICY "Subcontractors[^"]*"[\s\S]{0,200}?FOR DELETE/);
  });

  it("never grants them the company roster or billing tables", () => {
    for (const table of ["team_members", "team_invites", "teams"]) {
      const policies =
        sql.match(new RegExp(`CREATE POLICY[^;]*ON public\\.${table}\\b`, "g")) ?? [];
      expect(policies).toEqual([]);
    }
  });

  it("revokes anon on both new tables, like every table since 20260811", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.subcontractors FROM anon, PUBLIC;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.subcontractor_projects FROM anon, PUBLIC;/);
  });
});

describe("family: the accept path cannot be used to take over an account", () => {
  const src = read(SERVICE);

  it("public signup refuses an address that already has an account", () => {
    // Otherwise an invite link is an unauthenticated password reset.
    expect(src).toMatch(/An account already exists for this email\./);
    expect(src).toMatch(/status: 409/);
  });

  it("public signup does not pre-confirm the address", () => {
    const signup = src.slice(src.indexOf("acceptSubcontractorInviteSignupService"));
    expect(signup).not.toMatch(/email_confirm:\s*true/);
  });

  it("the authenticated accept requires the session to be the invited address", () => {
    expect(src).toMatch(/signedInAs !== String\(s\.email\)\.toLowerCase\(\)/);
  });

  it("the token is claimed with a conditional update, not a read-then-write", () => {
    const claim = src.slice(src.indexOf("async function claimSubcontractorInvite"));
    expect(claim).toMatch(/\.is\("accepted_at", null\)/);
    expect(claim).toMatch(/\.is\("revoked_at", null\)/);
  });
});
