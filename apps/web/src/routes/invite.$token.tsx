import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, CheckCircle2, AlertCircle, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { BrandLogo } from "@/components/BrandLogo";
import { MobileAppBanner } from "@/components/MobileAppBanner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/sitepix/client";
import { lookupInvite, acceptInvite, acceptInviteSignup } from "@/lib/teams.functions";
import heroImg from "@/assets/hero-construction.png";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Accept your invitation - Everbreeze SitePix" }] }),
  component: AcceptInvitePage,
});

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

  const [state, setState] = useState<"loading" | "ready" | "invalid" | "accepted" | "error">(
    "loading",
  );
  const [team, setTeam] = useState<{ id: string; name: string } | null>(null);
  const [invite, setInvite] = useState<any | null>(null);
  const [message, setMessage] = useState<string>("");

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        data: { token, fullName: fullName.trim(), password },
      });
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: res.email,
        password,
      });
      if (signErr) throw signErr;
      setState("accepted");
      setTimeout(() => navigate({ to: "/projects" }), 900);
    } catch (err: any) {
      setMessage(err?.message ?? "Could not complete signup");
    } finally {
      setSubmitting(false);
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
              Everbreeze <span className="text-sidebar-ring">SitePix</span>
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
                ? `${team.name} uses SitePix to keep every job site documented - photos, walkthroughs and reports in one place.`
                : "Photos, walkthroughs, reports, and your project history - all in the same place."}
            </p>

            <ul className="mt-8 space-y-3">
              <FeatureItem text="Photos sorted by job automatically" />
              <FeatureItem text="Live updates from every active site" />
              <FeatureItem text="Share ready-to-send client reports" />
            </ul>
          </div>

          <p className="font-manrope text-xs text-sidebar-foreground/45">
            © {new Date().getFullYear()} Everbreeze SitePix
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
                Everbreeze <span className="text-primary">SitePix</span>
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
              <p className="font-manrope mt-4 text-sm leading-[24px] text-muted-foreground">
                You've been invited as a{" "}
                <span className="font-bold capitalize text-foreground">{invite.role}</span>. You'll
                get access to all of {teamName}'s projects, photos, and reports.
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
