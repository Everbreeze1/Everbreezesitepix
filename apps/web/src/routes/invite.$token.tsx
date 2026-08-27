import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CircleCheck,
  CheckCircle2,
  AlertCircle,
  LogIn,
  Loader2,
  MailCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { BrandLogo } from "@/components/BrandLogo";
import { MobileAppBanner } from "@/components/MobileAppBanner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/everlumen/client";
import {
  lookupInvite,
  acceptInvite,
  acceptInviteSignup,
  resendInviteConfirmation,
} from "@/lib/teams.functions";
import { authErrorMessage, isUnconfirmedEmail } from "@/lib/auth-errors";
import heroImg from "@/assets/hero-construction.png";
import { can, roleLabelForTier, type BillingTier } from "@everlumen/shared/team-permissions";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Accept your invitation - Everlumen" }] }),
  component: AcceptInvitePage,
});

/** Supabase's per-address resend window is ~60s; match it rather than guess. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Shared field styling, lifted verbatim from the signup page. */
const FIELD_CLASS =
  "h-[45.6px] rounded-lg border-border font-manrope text-sm placeholder:text-[#9CA3AF]";

/*
 * The invite page is a SIGNUP page, so it is built on the signup page's layout.
 *
 * It used to be a lone `Card` centred on an empty gradient - no marketing panel,
 * no wordmark beyond a bare logo, none of the display type the rest of the
 * product uses. For most invitees this is the very first screen they ever see of
 * the product, arriving straight from an email, and it looked like a different
 * and much cheaper application than the one they were being invited into.
 *
 * Deliberately no OAuth buttons, unlike /signup: `acceptInviteSignup` creates
 * the account server-side against the invited address and needs a password.
 * Someone who would rather use Google signs in first via "Sign in instead" and
 * then accepts, which the signed-in branch below handles.
 */
function AcceptInvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState<
    "loading" | "ready" | "confirm" | "invalid" | "accepted" | "error"
  >("loading");
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [invite, setInvite] = useState<any | null>(null);
  // The plan this team is on, only so the seat is named the way that tier
  // names it. Starter until the lookup says otherwise.
  const [tier, setTier] = useState<BillingTier>("starter");
  const [message, setMessage] = useState<string>("");

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /*
   * The "check your email" state. `confirmationSent` is false when the server
   * told us it could not send the message, which is the difference between
   * "wait a minute" and "press this button", and the invitee is the only
   * person who can tell those apart from where they are standing.
   */
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(true);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    (async () => {
      try {
        const res: any = await lookupInvite({ data: { token } });
        const inv = res?.invite;
        if (!inv) {
          setState("invalid");
          setMessage("This invite link is invalid.");
          return;
        }
        if (inv.accepted_at) {
          setState("invalid");
          setMessage("This invite has already been used.");
          return;
        }
        if (new Date(inv.expires_at) < new Date()) {
          setState("invalid");
          setMessage("This invite has expired.");
          return;
        }
        setInvite(inv);
        setTeam(res?.team ?? null);
        setTier((res?.tier as BillingTier) ?? "starter");
        setState("ready");
      } catch (e: any) {
        setState("error");
        setMessage(e?.message ?? "Failed to load invite");
      }
    })();
  }, [token]);

  const doSignupAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (fullName.trim().length < 1) return setMessage("Please enter your full name.");
    if (password.length < 8) return setMessage("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setMessage("Passwords do not match.");

    setSubmitting(true);
    try {
      const res: any = await acceptInviteSignup({
        data: {
          token,
          fullName: fullName.trim(),
          password,
          // Mint the confirmation link on the host they are actually using.
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });

      /*
       * Past this line the account exists, the team membership exists, and the
       * invite token is SPENT. So every branch from here has to be terminal:
       * leaving them on the form means their only next move is to submit it
       * again, and that submit is guaranteed to come back "This invite has
       * already been used."
       *
       * Which is exactly what used to happen. The account is created
       * unconfirmed on purpose (see the SECURITY note in
       * `acceptInviteSignupService`), so this sign-in legitimately fails with
       * "Email not confirmed" on any project that requires confirmation - and
       * that error was thrown into the catch below and rendered raw, in the
       * error colour, under a form that could never succeed again. Nothing on
       * screen said an account had been created, that they had joined the
       * team, or that a confirmation email was on its way. The owner then saw
       * them on the roster as "Email not confirmed" and the teammate believed
       * signup had failed. That is the bug this page was reported for.
       */
      const email: string = res?.email ?? invite.email;
      setConfirmEmail(email);

      /*
       * Its own try, so that even a thrown sign-in (offline, DNS, a proxy
       * eating the request) lands on the panel below rather than in the catch
       * at the bottom, which would put them back on the unsubmittable form.
       */
      let signErr: unknown = null;
      try {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        signErr = error;
      } catch (e) {
        signErr = e;
      }

      if (!signErr) {
        setState("accepted");
        setTimeout(() => navigate({ to: "/projects" }), 900);
        return;
      }

      console.error("[invite] sign-in after signup failed", signErr);
      const sent = res?.confirmationEmailSent !== false;
      setConfirmationSent(sent);
      // A message we just sent starts the clock; one that failed to send must
      // not, or the way out is greyed out for a minute.
      setCooldown(sent ? RESEND_COOLDOWN_SECONDS : 0);
      /*
       * "Email not confirmed" is the expected answer here and the panel below
       * already says so far better than an error line would. Anything else is
       * genuinely unexpected and worth showing.
       */
      setMessage(isUnconfirmedEmail(signErr) ? "" : authErrorMessage(signErr));
      setState("confirm");
    } catch (err: any) {
      // Nothing was created: `acceptInviteSignup` releases its claim on any
      // failure, so the invite is still open and the form is still the way in.
      setMessage(err?.message ?? "Could not complete signup");
    } finally {
      setSubmitting(false);
    }
  };

  const doResendConfirmation = async () => {
    setResending(true);
    try {
      const res: any = await resendInviteConfirmation({
        data: {
          token,
          origin: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (res?.alreadyConfirmed) {
        setConfirmationSent(true);
        setMessage("That address is already confirmed. You can sign in now.");
        return;
      }
      if (res?.emailSent) {
        setConfirmationSent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
        setMessage("");
        return;
      }
      setConfirmationSent(false);
      setMessage("We still could not send it. Ask whoever invited you to resend from Team.");
    } catch (e: any) {
      setMessage(e?.message ?? "Could not send that email");
    } finally {
      setResending(false);
    }
  };

  const doAcceptExisting = async () => {
    setSubmitting(true);
    try {
      await acceptInvite({ data: { token } });
      setState("accepted");
      setTimeout(() => navigate({ to: "/projects" }), 900);
    } catch (e: any) {
      setMessage(e?.message ?? "Failed to accept invite");
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  const teamName = team?.name ?? "the team";

  return (
    <div className="min-h-screen w-full bg-background lg:grid lg:grid-cols-2">
      {/* LEFT - marketing panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        {/* A CSS background, not an <img> - see the note in signup.tsx: an <img>
            in a `hidden lg:flex` subtree is still downloaded on every phone. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35"
          style={{ backgroundImage: `url(${heroImg})` }}
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-sidebar/75" />

        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <Link to="/" className="inline-flex w-fit items-center gap-2.5">
            <BrandLogo size={40} />
            <span className="font-manrope text-lg font-extrabold tracking-tight text-sidebar-foreground">
              Ever<span className="text-brand-gold">lumen</span>
            </span>
          </Link>

          <div className="max-w-[448px]">
            <p className="font-manrope text-xs font-extrabold uppercase leading-4 tracking-[1.92px] text-sidebar-ring">
              You've been invited
            </p>
            <h1 className="font-display mt-4 text-[60px] font-black uppercase leading-[0.9] tracking-[-2.1px] text-sidebar-foreground">
              Join the <span className="text-sidebar-ring">crew.</span>
            </h1>
            <p className="font-manrope mt-6 text-base leading-7 text-sidebar-foreground/70">
              {state === "ready" && team
                ? `${team.name} uses Everlumen to keep every job site documented - photos, walkthroughs and reports in one place.`
                : "Photos, walkthroughs, reports, and your project history - all in the same place."}
            </p>

            <ul className="mt-8 space-y-3">
              <FeatureItem text="Photos sorted by job automatically" />
              <FeatureItem text="Live updates from every active site" />
              <FeatureItem text="Share ready-to-send client reports" />
            </ul>
          </div>

          <p className="font-manrope text-xs text-sidebar-foreground/45">
            © {new Date().getFullYear()} Everlumen
          </p>
        </div>
      </aside>

      {/* RIGHT - the invite itself */}
      <div className="flex min-h-screen flex-col items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto flex w-full max-w-[448px] flex-1 flex-col justify-center lg:flex-none">
          <div className="mb-4 lg:hidden">
            <MobileAppBanner />
          </div>

          <div className="mb-6 flex items-center justify-center lg:hidden">
            <Link to="/" className="inline-flex items-center gap-2">
              <BrandLogo size={40} />
              <span className="font-manrope text-lg font-extrabold tracking-tight text-foreground">
                Ever<span className="text-brand">lumen</span>
              </span>
            </Link>
          </div>

          {state === "loading" && (
            <div className="flex items-center justify-center gap-2 py-16 font-manrope text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your invitation…
            </div>
          )}

          {state === "ready" && invite && (
            <>
              <p className="font-manrope text-xs font-extrabold uppercase leading-4 tracking-[1.92px] text-primary">
                Team invitation
              </p>
              <h2 className="font-display mt-3 text-[48px] font-black uppercase leading-[0.92] tracking-[-1.68px] text-foreground">
                Join {teamName}.
              </h2>
              {/*
                What you are actually accepting.

                This printed `invite.role` raw under a CSS capitalize - the same
                unfriendly-value pattern the roster, Settings and Collaborators
                each carried - and then promised "access to all of the team's
                projects" regardless of which role it had just named. For a
                Restricted invite that sentence was simply false: they get the
                jobs they are ticked into and nothing else. Telling somebody the
                wrong thing at the moment they accept is the worst place in the
                product to get this wrong, so both halves now come from the
                shared matrix.
              */}
              {/*
                "Your role will be X", not "You've been invited as a X".
                Three of the five labels are adjectives - Standard, Restricted -
                so the old article-plus-noun frame produced "invited as a
                Standard". It read fine only while this page was printing the
                raw column, where the value happened to be the noun "member".
              */}
              <p className="font-manrope mt-4 text-sm leading-[24px] text-muted-foreground">
                Your role will be{" "}
                <span className="font-bold text-foreground">
                  {roleLabelForTier(invite.role, tier)}
                </span>
                .{" "}
                {can(invite.role, "view_all_projects")
                  ? `You'll get access to all of ${teamName}'s projects, photos, and reports.`
                  : `You'll get access to the jobs ${teamName} puts you on, and nothing else in the workspace.`}
              </p>
              {/*
                Second person, because the reader is the one holding the role.

                This briefly rendered `ROLE_DESCRIPTION` directly, which is
                written for the admin doing the assigning: a Restricted invitee
                was told "Sees only the jobs you assign them", making the reader
                both the assigner and the assignee in one sentence. Same matrix,
                same facts, addressed to the person actually reading it.
              */}
              <p className="font-manrope mt-2 text-sm leading-[24px] text-muted-foreground">
                {can(invite.role, "billing")
                  ? "You'll be able to manage the team, billing and every project."
                  : "You won't be able to manage the team or billing."}
              </p>

              {loading ? (
                <div className="mt-8 flex items-center gap-2 font-manrope text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
                </div>
              ) : user && user.email?.toLowerCase() === invite.email.toLowerCase() ? (
                /* Already signed in as the invited address - one button, no form. */
                <div className="mt-8 space-y-4">
                  <p className="font-manrope text-sm text-muted-foreground">
                    Signed in as <strong className="text-foreground">{user.email}</strong>
                  </p>
                  <Button
                    onClick={doAcceptExisting}
                    disabled={submitting}
                    className="h-12 w-full gap-2 rounded-lg bg-primary font-manrope text-sm font-bold text-primary-foreground hover:bg-primary/90"
                  >
                    {submitting ? "Joining…" : `Accept and join ${teamName}`}
                    {!submitting && <ArrowRight className="h-4 w-4" />}
                  </Button>
                  {message && <FormError>{message}</FormError>}
                </div>
              ) : user ? (
                /* Signed in as somebody else - the invite is not transferable. */
                <div className="mt-8 space-y-4">
                  <FormError>
                    You're signed in as <strong>{user.email}</strong>, but this invitation is for{" "}
                    <strong>{invite.email}</strong>.
                  </FormError>
                  <Button
                    variant="outline"
                    className="h-12 w-full rounded-lg font-manrope text-sm font-bold"
                    onClick={() => supabase.auth.signOut()}
                  >
                    Sign out and continue
                  </Button>
                </div>
              ) : (
                <form onSubmit={doSignupAndAccept} className="mt-8 space-y-5">
                  <div className="space-y-2">
                    <Label
                      htmlFor="email"
                      className="font-manrope text-sm font-bold text-foreground"
                    >
                      Email
                    </Label>
                    {/* Fixed: the account is created against the invited address. */}
                    <Input
                      id="email"
                      value={invite.email}
                      disabled
                      readOnly
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="fullName"
                      className="font-manrope text-sm font-bold text-foreground"
                    >
                      Full name
                    </Label>
                    <Input
                      id="fullName"
                      autoFocus
                      autoComplete="name"
                      placeholder="Jordan Smith"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="password"
                      className="font-manrope text-sm font-bold text-foreground"
                    >
                      Create password
                    </Label>
                    <PasswordInput
                      id="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="confirmPassword"
                      className="font-manrope text-sm font-bold text-foreground"
                    >
                      Confirm password
                    </Label>
                    <PasswordInput
                      id="confirmPassword"
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className={FIELD_CLASS}
                    />
                  </div>

                  {message && <FormError>{message}</FormError>}

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="h-12 w-full gap-2 rounded-lg bg-primary font-manrope text-sm font-bold text-primary-foreground hover:bg-primary/90"
                  >
                    {submitting ? "Creating your account…" : `Create account & join ${teamName}`}
                    {!submitting && <ArrowRight className="h-4 w-4" />}
                  </Button>

                  <p className="font-manrope text-center text-sm text-muted-foreground">
                    Already have an account with {invite.email}?{" "}
                    <Link
                      to="/login"
                      search={{ redirect: `/invite/${token}` } as any}
                      className="font-bold text-primary hover:underline"
                    >
                      <LogIn className="mr-0.5 inline h-3 w-3" /> Sign in instead
                    </Link>
                  </p>
                  <p className="font-manrope text-center text-xs leading-5 text-muted-foreground">
                    By continuing, you agree to our{" "}
                    <Link to="/terms-of-service" className="text-primary hover:underline">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link to="/privacy-policy" className="text-primary hover:underline">
                      Privacy Policy
                    </Link>
                    .
                  </p>
                </form>
              )}
            </>
          )}

          {/*
            The terminal state for an invitee whose account was created but who
            cannot sign in yet. It answers the three things they are staring at
            the screen wondering: did it work, what happens next, and what if
            the email never turns up.
          */}
          {state === "confirm" && (
            <div aria-live="polite">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <MailCheck className="h-7 w-7 text-primary" />
              </div>
              <h2 className="font-display mt-6 text-[40px] font-black uppercase leading-[0.92] tracking-[-1.4px] text-foreground">
                One more step
              </h2>
              <p className="font-manrope mt-4 text-sm leading-6 text-muted-foreground">
                Your account is created and you have joined {teamName}. Confirm{" "}
                <span className="font-bold text-foreground">{confirmEmail}</span> and you are in.
              </p>

              {confirmationSent ? (
                <>
                  <p className="font-manrope mt-3 text-sm leading-6 text-muted-foreground">
                    We sent a confirmation link to that address. Opening it signs you straight in.
                  </p>
                  <p className="font-manrope mt-3 text-sm leading-6 text-muted-foreground">
                    It usually arrives within a minute. Check your spam folder if you do not see it.
                  </p>
                </>
              ) : (
                <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 font-manrope text-sm leading-6 text-amber-700 dark:text-amber-400">
                  We could not send the confirmation email just now. Your account and your place on
                  the team are safe. Try again below.
                </div>
              )}

              {message && (
                <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3 font-manrope text-sm leading-6 text-muted-foreground">
                  {message}
                </div>
              )}

              <div className="mt-8 space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={doResendConfirmation}
                  disabled={resending || cooldown > 0}
                  className="h-12 w-full rounded-lg font-manrope text-sm font-bold"
                >
                  {resending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : cooldown > 0 ? (
                    `Resend confirmation email (${cooldown}s)`
                  ) : (
                    "Resend confirmation email"
                  )}
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-12 w-full rounded-lg font-manrope text-sm font-bold text-muted-foreground"
                >
                  <Link to="/login">Already confirmed? Sign in</Link>
                </Button>
              </div>
            </div>
          )}

          {state === "accepted" && (
            <div className="py-10 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-primary" />
              <h2 className="font-display mt-5 text-[36px] font-black uppercase leading-[0.95] tracking-[-1.2px] text-foreground">
                You're in.
              </h2>
              <p className="font-manrope mt-3 text-sm text-muted-foreground">
                Taking you to your projects…
              </p>
            </div>
          )}

          {(state === "invalid" || state === "error") && (
            <div className="py-10 text-center">
              <AlertCircle className="mx-auto h-14 w-14 text-destructive" />
              <h2 className="font-display mt-5 text-[36px] font-black uppercase leading-[0.95] tracking-[-1.2px] text-foreground">
                Invite unavailable
              </h2>
              <p className="font-manrope mt-3 text-sm text-muted-foreground">
                {message || "Please ask for a new invite."}
              </p>
              <Button
                asChild
                variant="outline"
                className="mt-6 h-12 rounded-lg font-manrope text-sm font-bold"
              >
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-3">
      <CircleCheck className="h-5 w-5 shrink-0 text-sidebar-ring" strokeWidth={1.8} />
      <span className="font-manrope text-sm font-bold text-sidebar-foreground/85">{text}</span>
    </li>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 font-manrope text-sm text-destructive">
      {children}
    </div>
  );
}
