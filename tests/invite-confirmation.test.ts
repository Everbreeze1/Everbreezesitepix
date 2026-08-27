import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const TEAMS_SERVICE = "apps/api/src/domains/teams/service.ts";
const SUBS_SERVICE = "apps/api/src/domains/subcontractors/service.ts";
const INVITE_PAGE = "apps/web/src/routes/invite.$token.tsx";

/*
 * The reported bug, in the customer's words: "I have added team mates that
 * have not gotten their confirmation email and logged in properly."
 *
 * Two separate faults produced it, and either one alone is enough to strand
 * somebody:
 *
 *   1. The confirmation mail was handed to `auth.resend`, which is GoTrue's
 *      mailer. GoTrue does not send it itself: it calls the project's Send
 *      Email hook over HTTPS, and if that URL does not answer, nothing is
 *      composed or delivered. Against production this returned 422
 *      `hook_timeout_after_retry`. Invite mail goes out over Resend without
 *      involving GoTrue, so it always arrived - which is why an owner adding a
 *      crew watched every invitation land and every confirmation vanish.
 *
 *   2. The invite page threw the resulting "Email not confirmed" sign-in error
 *      into a catch that rendered it raw, under a form whose token was already
 *      spent. Nothing said an account had been created or that a confirmation
 *      was coming, and resubmitting could only ever answer "This invite has
 *      already been used."
 */

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  generateLink: vi.fn(),
  resend: vi.fn(),
}));

vi.mock("../apps/api/src/lib/send-email", () => ({
  sendEmail: mocks.sendEmail,
}));

vi.mock("../apps/api/src/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    auth: {
      admin: { generateLink: mocks.generateLink },
      resend: mocks.resend,
    },
  }),
}));

const { sendSignupConfirmationEmail } =
  await import("../apps/api/src/domains/email/signup-confirmation");

describe("the confirmation email is ours to deliver, not GoTrue's", () => {
  beforeEach(() => {
    mocks.sendEmail.mockReset().mockResolvedValue({ id: "msg_1" });
    mocks.generateLink.mockReset();
    mocks.resend.mockReset();
  });

  it("mints the token with generateLink and sends it over Resend", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "HASHED_TOKEN" } },
      error: null,
    });

    const res = await sendSignupConfirmationEmail("crew@example.com", "https://www.everlumen.co", {
      password: "correct horse battery",
    });

    expect(res).toEqual({ sent: true, via: "resend", reason: null });
    // The whole point: GoTrue's rate-limited mailer is never asked.
    expect(mocks.resend).not.toHaveBeenCalled();

    const [linkArgs] = mocks.generateLink.mock.calls[0];
    expect(linkArgs.type).toBe("signup");
    expect(linkArgs.email).toBe("crew@example.com");
    expect(linkArgs.options.redirectTo).toBe("https://www.everlumen.co/dashboard");

    const [mail] = mocks.sendEmail.mock.calls[0];
    expect(mail.to).toBe("crew@example.com");
    expect(mail.subject).toBe("Confirm your email");
    // The link carries the minted token and lands on our own confirm page.
    expect(mail.html).toContain("HASHED_TOKEN");
    expect(mail.html).toContain("/auth/confirm?");
    expect(mail.html).not.toContain("supabase.co");
  });

  it("asks for a magic link when no password is supplied", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "T" } },
      error: null,
    });

    await sendSignupConfirmationEmail("crew@example.com", "https://www.everlumen.co");

    const [linkArgs] = mocks.generateLink.mock.calls[0];
    /*
     * An owner pressing "Resend confirmation" has no business supplying a
     * password, and `generateLink({ type: "signup" })` takes one. A magic link
     * confirms an unconfirmed address just as a signup token does, without
     * this op ever being in a position to change somebody's password.
     */
    expect(linkArgs.type).toBe("magiclink");
    expect(linkArgs.password).toBeUndefined();
  });

  it("trims a trailing slash off the origin rather than doubling it", async () => {
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "T" } },
      error: null,
    });

    await sendSignupConfirmationEmail("crew@example.com", "http://localhost:5173/");

    const [linkArgs] = mocks.generateLink.mock.calls[0];
    expect(linkArgs.options.redirectTo).toBe("http://localhost:5173/dashboard");
  });

  it("falls back to GoTrue rather than sending nothing", async () => {
    mocks.generateLink.mockResolvedValue({ data: null, error: { message: "not permitted" } });
    mocks.resend.mockResolvedValue({ error: null });

    const res = await sendSignupConfirmationEmail("crew@example.com", "https://www.everlumen.co");

    expect(res.sent).toBe(true);
    expect(res.via).toBe("gotrue");
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.resend).toHaveBeenCalledTimes(1);
  });

  it("reports a failure instead of claiming a send", async () => {
    mocks.generateLink.mockResolvedValue({ data: null, error: { message: "not permitted" } });
    mocks.resend.mockResolvedValue({ error: { message: "email rate limit exceeded" } });

    const res = await sendSignupConfirmationEmail("crew@example.com", "https://www.everlumen.co");

    /*
     * `sent: false` is what lets the invite page say "we could not send it,
     * press this" instead of "check your inbox" at somebody who has nothing
     * coming.
     */
    expect(res).toEqual({ sent: false, via: null, reason: "email rate limit exceeded" });
  });
});

describe("no signup path leaves an account with no way to confirm it", () => {
  it("both invite flows ask for the confirmation mail", () => {
    for (const file of [TEAMS_SERVICE, SUBS_SERVICE]) {
      expect(read(file), file).toMatch(/sendSignupConfirmationEmail\(/);
    }
  });

  it("neither flow calls GoTrue's mailer directly any more", () => {
    for (const file of [TEAMS_SERVICE, SUBS_SERVICE]) {
      expect(read(file), file).not.toMatch(/auth\.resend\(/);
    }
  });

  it("both report whether the mail actually went out", () => {
    for (const file of [TEAMS_SERVICE, SUBS_SERVICE]) {
      expect(read(file), file).toMatch(/confirmationEmailSent:/);
    }
  });
});

describe("the invite page never strands a spent invite on the form", () => {
  const src = read(INVITE_PAGE);

  it("a failed sign-in becomes a terminal state, not a thrown error", () => {
    /*
     * `throw signErr` is the exact line that produced the bug: the token is
     * already spent by the time it runs, so the catch put a raw auth error
     * over a form that could never be submitted again.
     */
    expect(src).not.toMatch(/throw signErr/);
    expect(src).toMatch(/setState\("confirm"\)/);
  });

  it("offers the invitee a resend of their own", () => {
    expect(src).toMatch(/resendInviteConfirmation/);
    expect(src).toMatch(/doResendConfirmation/);
  });

  it("mints the confirmation link on the host they accepted on", () => {
    const accept = src.slice(src.indexOf("await acceptInviteSignup("));
    expect(accept.slice(0, 400)).toMatch(/origin:/);
  });
});

describe("the public resend can only ever mail the invited address", () => {
  const src = read(TEAMS_SERVICE);
  const fn = src.slice(src.indexOf("export async function resendInviteConfirmationService"));

  it("takes no address from the caller", () => {
    // Only `token` and `origin` are read off the payload. An address arriving
    // from an unauthenticated caller would make this a mail relay.
    expect(fn).not.toMatch(/data\.email/);
  });

  it("refuses unless the account still holds the invited address", () => {
    expect(fn).toMatch(/account\.email[\s\S]{0,80}!==\s*email/);
  });

  it("is rate limited on the token", () => {
    expect(fn).toMatch(/limitInviteOp\("confirm", data\.token, INVITE_CONFIRM_RATE\)/);
  });

  it("says nothing about an address that is already confirmed beyond declining", () => {
    expect(fn).toMatch(/alreadyConfirmed: true, emailSent: false/);
  });
});
