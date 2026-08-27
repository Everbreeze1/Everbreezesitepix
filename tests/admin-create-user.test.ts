import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * "In the admin page, I think admin cant add user... it will be useful instead
 * of creating a new subscription."
 *
 * The console could read, suspend, re-role and delete accounts but never make
 * one, so seating one extra person on a team that already pays meant sending
 * them through self-serve signup - and the confirmation half of that was the
 * failure the same conversation opened with ("they get email but the sign in
 * process don't work for them").
 *
 * What is guarded here is mostly the set of decisions that make this safe:
 * which capability it needs, that a full team is refused rather than quietly
 * comped, that nothing is left half-created when a later step fails, and that
 * the mail goes out over the transport that actually delivers.
 */

const mocks = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  sendEmail: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  generateLink: vi.fn(),
  /** Every `from()` call, so a test can assert what was written where. */
  calls: [] as Array<{ table: string; op: string; payload?: unknown }>,
  /** table -> queued results, popped in order. */
  results: new Map<string, any[]>(),
}));

function queue(table: string, ...values: any[]) {
  mocks.results.set(table, [...(mocks.results.get(table) ?? []), ...values]);
}

function nextResult(table: string) {
  const queued = mocks.results.get(table);
  if (queued?.length) return queued.shift();
  return { data: null, error: null, count: 0 };
}

/**
 * A PostgREST-shaped double.
 *
 * Every builder method returns `this`, and the terminal methods
 * (`maybeSingle`, `single`) plus awaiting the builder itself resolve to the
 * next queued result for that table. That is enough to drive this service,
 * which only ever selects, upserts, inserts and deletes by equality.
 */
function makeQuery(table: string) {
  const builder: any = {
    then: (resolve: any, reject: any) => Promise.resolve(nextResult(table)).then(resolve, reject),
    maybeSingle: () => Promise.resolve(nextResult(table)),
    single: () => Promise.resolve(nextResult(table)),
  };
  for (const method of ["select", "eq", "is", "order", "limit", "neq", "in"]) {
    builder[method] = () => builder;
  }
  for (const method of ["insert", "upsert", "update", "delete"]) {
    builder[method] = (payload?: unknown) => {
      mocks.calls.push({ table, op: method, payload });
      return builder;
    };
  }
  return builder;
}

vi.mock("../apps/api/src/lib/admin-context", () => ({
  requirePlatformAdmin: mocks.requirePlatformAdmin,
}));

vi.mock("../apps/api/src/lib/send-email", () => ({ sendEmail: mocks.sendEmail }));

vi.mock("../apps/api/src/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      mocks.calls.push({ table, op: "from" });
      return makeQuery(table);
    },
    auth: {
      admin: {
        createUser: mocks.createUser,
        deleteUser: mocks.deleteUser,
        generateLink: mocks.generateLink,
      },
    },
  }),
}));

const { createPlatformUserService, createPlatformUserInputSchema } =
  await import("../apps/api/src/domains/admin/create-user");

const ctx = { userId: "admin-1" } as any;
const ACTOR_TEAM = {
  id: "team-1",
  name: "Everbreeze HVAC",
  plan: "pro",
  member_limit: null,
  is_internal: false,
};

function writes(table: string, op: string) {
  return mocks.calls.filter((c) => c.table === table && c.op === op);
}

beforeEach(() => {
  mocks.requirePlatformAdmin.mockReset().mockResolvedValue("superadmin");
  mocks.sendEmail.mockReset().mockResolvedValue({ id: "msg_1" });
  mocks.createUser.mockReset().mockResolvedValue({ data: { user: { id: "user-9" } }, error: null });
  mocks.deleteUser.mockReset().mockResolvedValue({ error: null });
  mocks.generateLink
    .mockReset()
    .mockResolvedValue({ data: { properties: { hashed_token: "HASH" } }, error: null });
  mocks.calls.length = 0;
  mocks.results.clear();
});

describe("creating an account from the console", () => {
  it("needs the superadmin capability, not merely support", async () => {
    // A support admin can already suspend and send resets, and neither hands
    // them access to anything: the mail goes to the customer's inbox. This one
    // can end in a working login into a customer's workspace.
    queue("profiles", { data: null, error: null });

    await createPlatformUserService(ctx, {
      email: "crew@example.com",
      team: undefined,
      note: undefined,
    } as any);

    expect(mocks.requirePlatformAdmin).toHaveBeenCalledWith("admin-1", "owner");
  });

  it("creates the address already confirmed", async () => {
    /*
     * The whole reason the feature was asked for. A confirmation mail proves
     * whoever typed an address can read it, and nobody typed this one - so an
     * unconfirmed admin-created account is inert in exactly the way the bug
     * report describes.
     */
    queue("profiles", { data: null, error: null });

    await createPlatformUserService(ctx, { email: "Crew@Example.com" } as any);

    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "crew@example.com", email_confirm: true }),
    );
  });

  it("never leaves the account without a password", async () => {
    // `inviteUserByEmail` used to create passwordless accounts nobody could
    // sign in to. A generated throwaway plus a set-password link is what
    // replaced that, so the account is enterable from the moment it exists.
    queue("profiles", { data: null, error: null });

    await createPlatformUserService(ctx, { email: "crew@example.com" } as any);

    const password = mocks.createUser.mock.calls[0][0].password as string;
    expect(password.length).toBeGreaterThanOrEqual(16);
  });

  it("mints a recovery link and sends it over Resend, not GoTrue's mailer", async () => {
    /*
     * The transport that was dropping confirmations delegates to the project's
     * Send Email hook; a hook that does not answer means nothing is composed.
     * An admin-created account has the least recourse of all - the recipient
     * did not ask for it, so they will not chase a mail that never came.
     */
    queue("profiles", { data: null, error: null });

    const res = await createPlatformUserService(ctx, { email: "crew@example.com" } as any);

    expect(mocks.generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recovery", email: "crew@example.com" }),
    );
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(res.emailSent).toBe(true);
    expect(res.setupLink).toContain("token_hash=HASH");
    expect(res.setupLink).toContain("type=recovery");
  });

  it("hands the link back even when the send fails", async () => {
    // The account exists by then and the person has no other way in, so the
    // credential has to be reachable from the console rather than lost with a
    // toast.
    queue("profiles", { data: null, error: null });
    mocks.sendEmail.mockRejectedValue(new Error("Resend error (422)"));

    const res = await createPlatformUserService(ctx, { email: "crew@example.com" } as any);

    expect(res.emailSent).toBe(false);
    expect(res.setupLink).toContain("token_hash=HASH");
    expect(res.emailReason).toContain("422");
  });

  it("does not mail a password it was handed", async () => {
    // Mail is not a channel to put a password in. The operator who typed it
    // passes it on themselves; the message only says the account is ready.
    queue("profiles", { data: null, error: null });

    const res = await createPlatformUserService(ctx, {
      email: "crew@example.com",
      password: "hunter2hunter2",
    } as any);

    const body = JSON.stringify(mocks.sendEmail.mock.calls[0][0]);
    expect(body).not.toContain("hunter2hunter2");
    // No set-password link either: they already have a password.
    expect(res.setupLink).toBeNull();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("refuses an address that already has an account, before writing anything", async () => {
    queue("profiles", { data: { id: "existing" }, error: null });

    await expect(
      createPlatformUserService(ctx, { email: "taken@example.com" } as any),
    ).rejects.toThrow(/already has an account/i);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("still says so when only GoTrue knows the address is taken", async () => {
    /*
     * The `profiles` probe cannot see an auth user with no profile row, or one
     * stored under different casing. GoTrue catches those, and its refusal has
     * to arrive as a 409 with an answer - an unclassified throw reaches the
     * console as a 500, so "this person already exists" would read as a crash.
     */
    queue("profiles", { data: null, error: null });
    mocks.createUser.mockResolvedValue({
      data: null,
      error: { message: "A user with this email address has already been registered" },
    });

    const err = await createPlatformUserService(ctx, { email: "taken@example.com" } as any).catch(
      (e) => e,
    );
    expect(err.message).toMatch(/already has an account/i);
    expect(err.status).toBe(409);
  });
});

describe("seating them on an existing team", () => {
  const withTeam = {
    email: "crew@example.com",
    note: "Replacing the foreman who left",
    team: { teamId: "team-1", role: "standard" as const, overSeatLimit: false },
  };

  it("refuses a full team rather than quietly handing out a seat", async () => {
    queue("profiles", { data: null, error: null });
    queue("teams", { data: { ...ACTOR_TEAM, member_limit: 2 }, error: null });
    queue("team_members", { count: 2, error: null });
    queue("team_invites", { count: 0, error: null });

    await expect(createPlatformUserService(ctx, withTeam as any)).rejects.toThrow(
      /using all 2 of its seats/i,
    );
    // Refused before the account exists, so there is no orphan to clean up.
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("counts open invites against the cap, the way inviteMember does", async () => {
    // A seat somebody is already on their way into is not a free seat.
    queue("profiles", { data: null, error: null });
    queue("teams", { data: { ...ACTOR_TEAM, member_limit: 3 }, error: null });
    queue("team_members", { count: 2, error: null });
    queue("team_invites", { count: 1, error: null });

    await expect(createPlatformUserService(ctx, withTeam as any)).rejects.toThrow(/seats/i);
  });

  it("lets a superadmin go past the cap deliberately, and records that", async () => {
    queue("profiles", { data: null, error: null });
    queue("teams", { data: { ...ACTOR_TEAM, member_limit: 2 }, error: null });
    queue("team_members", { count: 5, error: null });
    queue("team_invites", { count: 0, error: null });
    queue("team_members", { data: { id: "member-1" }, error: null });

    const res = await createPlatformUserService(ctx, {
      ...withTeam,
      team: { ...withTeam.team, overSeatLimit: true },
    } as any);

    expect(res.team).toMatchObject({ id: "team-1", role: "standard", overSeatLimit: true });
    const audit = writes("admin_audit_log", "insert")[0]?.payload as any;
    expect(audit.action).toBe("create_user");
    expect(audit.metadata.overSeatLimit).toBe(true);
    expect(audit.metadata.note).toBe("Replacing the foreman who left");
  });

  it("refuses a role the team's plan cannot hold", async () => {
    // Manager is Team-only. Offering it on a Pro team would be a role that
    // silently means something else.
    queue("profiles", { data: null, error: null });
    queue("teams", { data: ACTOR_TEAM, error: null });

    await expect(
      createPlatformUserService(ctx, {
        ...withTeam,
        team: { teamId: "team-1", role: "manager", overSeatLimit: false },
      } as any),
    ).rejects.toThrow(/not available/i);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("deletes the auth user when the membership write fails", async () => {
    /*
     * A confirmed login that belongs to no team and that the operator does not
     * know exists is worse than a clean failure: the next attempt hits the
     * "already has an account" refusal and there is nothing on screen
     * explaining why.
     */
    queue("profiles", { data: null, error: null });
    queue("teams", { data: ACTOR_TEAM, error: null });
    queue("team_members", { count: 1, error: null });
    queue("team_invites", { count: 0, error: null });
    queue("profiles", { data: null, error: null });
    queue("team_members", { data: null, error: { message: "insert failed" } });

    await expect(createPlatformUserService(ctx, withTeam as any)).rejects.toThrow(/insert failed/i);
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-9");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("gives back the seat if the team filled up mid-create", async () => {
    // Check-then-act: the count and the insert are separated by awaits, so two
    // concurrent adds can both clear a check that had one seat left.
    queue("profiles", { data: null, error: null });
    queue("teams", { data: { ...ACTOR_TEAM, member_limit: 5 }, error: null });
    queue("team_members", { count: 4, error: null });
    queue("team_invites", { count: 0, error: null });
    queue("profiles", { data: null, error: null });
    queue("team_members", { data: { id: "member-1" }, error: null });
    queue("team_members", { count: 6, error: null });

    await expect(createPlatformUserService(ctx, withTeam as any)).rejects.toThrow(/last seat/i);
    expect(writes("team_members", "delete")).toHaveLength(1);
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-9");
  });
});

describe("the audit trail", () => {
  it("requires a reason only when a team is attached", () => {
    // The boundary is the point: a bare account reaches into nobody's data,
    // while a seat on a customer's team is the run of their workspace.
    expect(
      createPlatformUserInputSchema.safeParse({ email: "a@b.com" }).success,
      "a bare account needs no reason",
    ).toBe(true);

    expect(
      createPlatformUserInputSchema.safeParse({
        email: "a@b.com",
        team: { teamId: "00000000-0000-4000-8000-000000000000", role: "standard" },
      }).success,
      "a team attachment does",
    ).toBe(false);
  });

  it("never offers owner as an assignable role", () => {
    // Ownership is transferred, not granted - the rule the product keeps.
    expect(
      createPlatformUserInputSchema.safeParse({
        email: "a@b.com",
        note: "taking over",
        team: { teamId: "00000000-0000-4000-8000-000000000000", role: "owner" },
      }).success,
    ).toBe(false);
  });

  it("distinguishes a mailed link from a handed-over password", async () => {
    queue("profiles", { data: null, error: null });

    await createPlatformUserService(ctx, {
      email: "crew@example.com",
      password: "hunter2hunter2",
    } as any);

    const audit = writes("admin_audit_log", "insert")[0]?.payload as any;
    expect(audit.metadata.accessMode).toBe("sign_in");
    // The password itself is never written to the log.
    expect(JSON.stringify(audit)).not.toContain("hunter2hunter2");
  });
});

describe("the resend paths this shipped alongside", () => {
  /*
   * The customer's opening sentence was "when I add users they can't confirm
   * email". Both "Resend confirmation" buttons in the console were still
   * calling `auth.resend`, which is the GoTrue mailer that was returning 422
   * `hook_timeout_after_retry` in production - so the one control an operator
   * had for that complaint was itself sending nothing.
   */
  it("no longer hands the console's resends to GoTrue's mailer", () => {
    for (const file of [
      "apps/api/src/domains/admin/user-detail.ts",
      "apps/api/src/domains/admin/user-directory.ts",
    ]) {
      const src = read(file);
      expect(src, `${file} should not call auth.resend`).not.toMatch(/auth\.resend\(/);
      expect(src).toContain("sendSignupConfirmationEmail");
    }
  });

  it("reports a failed bulk resend as a failure instead of counting it", () => {
    // "40 done" while nothing was sent is the worst version of this bug,
    // because it also closes the ticket.
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toMatch(/if \(!res\.sent\) throw new Error/);
  });
});

describe("where the console offers it", () => {
  it("is registered as an op, so the button has something to call", () => {
    const src = read("apps/api/src/domains/rpc/registry.ts");
    expect(src).toContain("createPlatformUser: authed(");
  });

  it("reaches it from the users list and from a team's own page", () => {
    // Two entry points because there are two questions. "Add a user" is the
    // one that was reported missing; "Add member" on a team is the one the
    // reason behind it describes - seating somebody on a customer who already
    // pays, instead of selling them their own subscription.
    expect(read("apps/web/src/features/admin/pages/AdminUsersPage.tsx")).toContain(
      "<CreateUserDialog",
    );
    const teamPage = read("apps/web/src/features/admin/pages/AdminTeamDetailPage.tsx");
    expect(teamPage).toContain("<CreateUserDialog");
    expect(teamPage).toContain("presetTeam");
  });

  it("names the new action in the audit log instead of printing its identifier", () => {
    /*
     * `labelFor` falls through to the raw action string, so a new action that
     * nobody adds here shows up in the log as `create_user`. The customer
     * reads raw identifiers on screen as the product being unfinished, and an
     * audit log is the last screen that should look that way.
     */
    const src = read("apps/web/src/features/admin/pages/AdminAuditLogPage.tsx");
    expect(src).toContain('create_user: "Created an account"');
  });

  it("disables the control for admins who lack the capability rather than hiding it", () => {
    /*
     * A control that is simply absent reads as a missing feature, which is how
     * this screen got reported as "admin cant add user" in the first place. It
     * is shown to every admin and explains itself to the ones who may not use
     * it - the same bargain the rest of the console makes.
     */
    for (const file of [
      "apps/web/src/features/admin/pages/AdminUsersPage.tsx",
      "apps/web/src/features/admin/pages/AdminTeamDetailPage.tsx",
    ]) {
      const src = read(file);
      expect(src, `${file} should gate on the owner capability`).toContain('denyReason("owner")');
      expect(src).toMatch(/disabled=\{[^}]*deniedCreate/);
    }
  });
});
