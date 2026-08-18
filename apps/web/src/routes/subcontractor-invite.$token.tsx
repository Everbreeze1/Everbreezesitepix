import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, HardHat, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/sitepix/client";
import {
  acceptSubcontractorInvite,
  acceptSubcontractorInviteSignup,
  lookupSubcontractorInvite,
} from "@/lib/subcontractors.functions";

export const Route = createFileRoute("/subcontractor-invite/$token")({
  head: () => ({ meta: [{ title: "Job site access - Everbreeze SitePix" }] }),
  component: AcceptSubcontractorInvitePage,
});

const FIELD_CLASS =
  "h-[45.6px] rounded-lg border-border font-manrope text-sm placeholder:text-[#9CA3AF]";

/**
 * Where a subcontractor's invitation email lands.
 *
 * Deliberately a plainer page than /invite/$token. That one is a recruitment
 * screen - it sells the product to someone joining a company that just bought
 * it. This person is not joining anything: they are an outside firm being let
 * into one job, probably on a phone, probably standing on site. What they need
 * is to know which company let them in, what they will be able to do, and a way
 * through in as few taps as possible.
 *
 * The honesty about scope is the point of the copy. A login that only opens two
 * jobs is a surprise unless somebody says so first.
 */
function AcceptSubcontractorInvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState<"loading" | "ready" | "invalid" | "accepted" | "error">(
    "loading",
  );
  const [invite, setInvite] = useState<{ email: string; teamName: string | null } | null>(null);
  const [message, setMessage] = useState("");

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res: any = await lookupSubcontractorInvite({ data: { token } });
        if (!res?.valid) {
          setState("invalid");
          setMessage(
            res?.reason === "used"
              ? "This invitation has already been used."
              : res?.reason === "expired"
                ? "This invitation has expired. Ask the contractor to send a new one."
                : "This invitation link is not valid.",
          );
          return;
        }
        setInvite({ email: res.email, teamName: res.teamName });
        setState("ready");
      } catch (e: any) {
        setState("error");
        setMessage(e?.message ?? "Failed to load this invitation");
      }
    })();
  }, [token]);

  const companyName = invite?.teamName ?? "a contractor";

  const doSignupAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (fullName.trim().length < 1) return setMessage("Please enter your name.");
    if (password.length < 8) return setMessage("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setMessage("Passwords do not match.");

    setSubmitting(true);
    try {
      await acceptSubcontractorInviteSignup({
        data: { token, fullName: fullName.trim(), password },
      });
      // The account is created unconfirmed on purpose (see the service), so a
      // sign-in here may legitimately fail until they click the confirmation
      // mail. Landing them on the projects list either way is wrong, so the
      // failure branch says what actually has to happen next.
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: invite!.email,
        password,
      });
      if (signErr) {
        setState("accepted");
        setMessage("Check your email to confirm your address, then sign in.");
        return;
      }
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
      await acceptSubcontractorInvite({ data: { token } });
      setState("accepted");
      setTimeout(() => navigate({ to: "/projects" }), 900);
    } catch (e: any) {
      setMessage(e?.message ?? "Could not accept this invitation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[448px]">
        <Link to="/" className="mb-8 inline-flex items-center gap-2">
          <BrandLogo size={40} />
          <span className="font-manrope text-lg font-extrabold tracking-tight text-foreground">
            Everbreeze <span className="text-primary">SitePix</span>
          </span>
        </Link>

        {state === "loading" && (
          <div className="flex items-center gap-2 py-16 font-manrope text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your invitation...
          </div>
        )}

        {(state === "invalid" || state === "error") && (
          <div className="rounded-2xl border border-border bg-card p-6">
            <p className="font-display text-xl font-bold text-foreground">
              This link will not open
            </p>
            <p className="mt-2 font-manrope text-sm text-muted-foreground">{message}</p>
          </div>
        )}

        {state === "accepted" && (
          <div className="rounded-2xl border border-border bg-card p-6">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <p className="mt-3 font-display text-xl font-bold text-foreground">You're in</p>
            <p className="mt-2 font-manrope text-sm text-muted-foreground">
              {message || `Taking you to your jobs for ${companyName}...`}
            </p>
          </div>
        )}

        {state === "ready" && invite && (
          <>
            <p className="inline-flex items-center gap-1.5 font-manrope text-xs font-extrabold uppercase tracking-[1.92px] text-primary">
              <HardHat className="h-3.5 w-3.5" /> Site access
            </p>
            <h1 className="font-display mt-3 text-[40px] font-black uppercase leading-[0.95] tracking-[-1.4px] text-foreground">
              {companyName} added you to a job.
            </h1>
            <p className="mt-4 font-manrope text-sm leading-6 text-muted-foreground">
              You'll be able to see the jobs they assigned you and add photos to them. You will not
              see their other projects, their team, or anything to do with billing.
            </p>

            {loading ? (
              <div className="mt-8 flex items-center gap-2 font-manrope text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking your session...
              </div>
            ) : user && user.email?.toLowerCase() === invite.email.toLowerCase() ? (
              <div className="mt-8 space-y-4">
                <p className="font-manrope text-sm text-muted-foreground">
                  Signed in as <strong className="text-foreground">{user.email}</strong>
                </p>
                <Button
                  onClick={doAcceptExisting}
                  disabled={submitting}
                  className="h-12 w-full gap-2 rounded-lg font-manrope text-sm font-bold"
                >
                  {submitting ? "Getting you in..." : "Accept and see the jobs"}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </Button>
                {message && <FormError>{message}</FormError>}
              </div>
            ) : user ? (
              /* Signed in as somebody else. The grant is bound to the invited
                 address on the server, so this cannot be waved through here. */
              <div className="mt-8 space-y-4">
                <FormError>
                  You're signed in as <strong>{user.email}</strong>, but this invitation was sent to{" "}
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
                  <Label htmlFor="email" className="font-manrope text-sm font-bold text-foreground">
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
                    Your name
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
                  className="h-12 w-full gap-2 rounded-lg font-manrope text-sm font-bold"
                >
                  {submitting ? "Creating your login..." : "Create login and continue"}
                  {!submitting && <ArrowRight className="h-4 w-4" />}
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-destructive/10 px-3 py-2 font-manrope text-sm text-destructive">
      {children}
    </p>
  );
}
