import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CircleCheck, ArrowRight, MailCheck, Loader2 } from "lucide-react";
import { authErrorMessage } from "@/lib/auth-errors";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { BrandLogo } from "@/components/BrandLogo";
import { MobileAppBanner } from "@/components/MobileAppBanner";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import heroImg from "@/assets/hero-construction.png";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account — Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Create your Everbreeze SitePix account. Capture, organize, and share construction job site photos with AI photo analysis. Plans start at $24/mo.",
      },
      { property: "og:title", content: "Create account — Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "Create your Everbreeze SitePix account. Capture, organize, and share construction job site photos with AI photo analysis. Plans start at $24/mo.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/signup" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/signup" }],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmEmailSent, setConfirmEmailSent] = useState(false);
  const [resending, setResending] = useState(false);
  const [oauthPending, setOauthPending] = useState<"google" | "apple" | null>(null);
  // Only offer social buttons the project has actually enabled — see the hook.
  const social = useAuthProviders();

  /*
   * Typed addresses arrive with stray whitespace far more often than you'd
   * think — autofill, and mobile keyboards that append a space after an
   * autocomplete. Supabase stores the address verbatim, so " a@b.com " signs up
   * an account the user can then never log into, because they type it cleanly
   * the second time. Normalise once, here, and use it everywhere below.
   */
  const cleanEmail = email.trim().toLowerCase();

  useEffect(() => {
    if (user) navigate({ to: "/dashboard", replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName.trim() },
      },
    });
    setLoading(false);
    if (error) {
      // Never render the raw message — see lib/auth-errors.ts.
      console.error("[signup] failed", error);
      return toast.error(authErrorMessage(error));
    }
    if (!data.session) {
      /*
       * Email confirmation is required, so there is no session and the
       * auth-state redirect never fires. This used to set state that nothing
       * rendered: the form just sat there behind a toast that faded after a
       * few seconds, at the single most important moment in the funnel. The
       * confirmation panel below is what that state was always meant to show.
       */
      setConfirmEmailSent(true);
      return;
    }
    toast.success("Account created! Redirecting…");
  };

  const handleResend = async () => {
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: cleanEmail,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setResending(false);
    if (error) {
      console.error("[signup] resend failed", error);
      return toast.error(authErrorMessage(error));
    }
    toast.success("Sent again — check your inbox.");
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    // Guarded: the redirect takes a moment, and a second click during it starts
    // a competing OAuth handshake.
    if (oauthPending) return;
    setOauthPending(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setOauthPending(null);
      console.error("[signup] oauth failed", error);
      toast.error(authErrorMessage(error, `${provider} sign-in failed`));
    }
  };

  return (
    <div className="min-h-screen w-full bg-background lg:grid lg:grid-cols-2">
      {/* LEFT — marketing panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        {/*
          A CSS background, not an <img>, and deliberately so.
          The panel is `hidden lg:flex`, but display:none does NOT stop a browser
          downloading an <img src> — so every phone visitor paid 1.9 MB for a
          decorative image they never see, on the signup page, before they have
          any reason to trust us with the wait. Background images inside a
          display:none subtree are never fetched, so this costs mobile nothing
          and looks identical on desktop.
        */}
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
              Field-ready documentation
            </p>
            <h1 className="font-display mt-4 text-[60px] font-black uppercase leading-[0.9] tracking-[-2.1px] text-sidebar-foreground">
              Know what happened. <span className="text-sidebar-ring">Prove it.</span>
            </h1>
            <p className="font-manrope mt-6 text-base leading-7 text-sidebar-foreground/70">
              Photos, walkthroughs, reports, and your project history — all in the same place.
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

      {/* RIGHT — form */}
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

          {confirmEmailSent ? (
            /*
             * Terminal state for the confirm-by-email path. It answers the three
             * things someone stares at this screen wondering: did it work, where
             * did it go, and what if it never arrives.
             */
            <div aria-live="polite">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <MailCheck className="h-7 w-7 text-primary" />
              </div>
              <h2 className="font-display mt-6 text-[40px] font-black uppercase leading-[0.92] tracking-[-1.4px] text-foreground">
                Check your email
              </h2>
              <p className="font-manrope mt-4 text-sm leading-6 text-muted-foreground">
                We sent a confirmation link to{" "}
                <span className="font-bold text-foreground">{cleanEmail}</span>. Click it to finish
                setting up your account.
              </p>
              <p className="font-manrope mt-3 text-sm leading-6 text-muted-foreground">
                It usually arrives within a minute. Check your spam folder if you don&apos;t see it.
              </p>
              {/*
                Covers the duplicate-signup dead end. Supabase deliberately
                answers a signup for an existing address with a success response
                and a placeholder user, so that an attacker cannot use this form
                to discover who has an account — which also means no email is
                sent and the person sits here waiting for one. We must not say
                "that address is taken" without undoing that protection, so the
                copy is conditional: it reads as generic advice to anyone who
                does have mail coming, and as the way out to anyone who doesn't.
              */}
              <p className="font-manrope mt-3 text-sm leading-6 text-muted-foreground">
                Already have an account with this email?{" "}
                <Link to="/login" className="font-bold text-primary hover:underline">
                  Log in instead
                </Link>{" "}
                — no new link is sent for an existing account.
              </p>

              <div className="mt-8 space-y-3">
                <Button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  variant="outline"
                  className="h-11 w-full rounded-lg font-manrope text-sm font-bold"
                >
                  {resending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Resend confirmation email"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmEmailSent(false)}
                  className="h-11 w-full rounded-lg font-manrope text-sm font-bold text-muted-foreground"
                >
                  Use a different email
                </Button>
              </div>

              <p className="font-manrope mt-7 text-center text-sm text-muted-foreground">
                Already confirmed?{" "}
                <Link to="/login" className="font-bold text-primary hover:underline">
                  Log in
                </Link>
              </p>
            </div>
          ) : (
            <>
          <p className="font-manrope text-xs font-extrabold uppercase leading-4 tracking-[1.92px] text-primary">
            Create your account
          </p>
          <h2 className="font-display mt-3 text-[48px] font-black uppercase leading-[0.92] tracking-[-1.68px] text-foreground">
            Bring your job sites into focus.
          </h2>
          <p className="font-manrope mt-4 text-sm leading-[24px] text-muted-foreground">
            Create your account and organize your first project in minutes.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-manrope text-sm font-bold text-foreground">
                Full name
              </Label>
              <Input
                id="name"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jordan Smith"
                className="h-[45.6px] rounded-lg border-border font-manrope text-sm placeholder:text-[#9CA3AF]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="font-manrope text-sm font-bold text-foreground">
                Work email
              </Label>
              {/*
                autoComplete/inputMode/autoCapitalize are what let a password
                manager save the credential and what gives a phone the email
                keyboard. Without autoCapitalize="none" iOS capitalises the
                first letter, which is one of the ways " A@B.com" gets typed in
                the first place.
              */}
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-[45.6px] rounded-lg border-border font-manrope text-sm placeholder:text-[#9CA3AF]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="font-manrope text-sm font-bold text-foreground">
                Password
              </Label>
              {/* "new-password" is what prompts a manager to offer to generate
                  and save one; "current-password" here would make it autofill
                  an existing credential instead. */}
              <PasswordInput
                id="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="h-[45.6px] rounded-lg border-border font-manrope text-sm placeholder:text-[#9CA3AF]"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="h-12 w-full gap-2 rounded-lg bg-primary font-manrope text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              {loading ? "Creating account…" : "Create account"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          {social.any && (
            <>
              <div className="mt-7 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="font-manrope text-xs text-muted-foreground">or continue with</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="mt-7 grid gap-2.5">
                {social.has("google") && (
                  <Button
                    type="button"
                    onClick={() => handleOAuth("google")}
                    disabled={!!oauthPending}
                    variant="outline"
                    className="h-10 w-full rounded-lg border-[#DAE2EA] bg-[#F9FCFF] font-manrope text-sm font-bold text-[#0B1C2C] shadow-sm hover:bg-[#F0F5FB]"
                  >
                    {oauthPending === "google" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <GoogleIcon />
                    )}
                    Continue with Google
                  </Button>
                )}
                {social.has("apple") && (
                  <Button
                    type="button"
                    onClick={() => handleOAuth("apple")}
                    disabled={!!oauthPending}
                    variant="outline"
                    className="h-10 w-full rounded-lg border-[#DAE2EA] bg-[#F9FCFF] font-manrope text-sm font-bold text-[#0B1C2C] shadow-sm hover:bg-[#F0F5FB]"
                  >
                    {oauthPending === "apple" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <AppleIcon />
                    )}
                    Continue with Apple
                  </Button>
                )}
              </div>
            </>
          )}

          <p className="font-manrope mt-7 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-bold text-primary hover:underline">
              Log in
            </Link>
          </p>
          <p className="font-manrope mt-4 text-center text-xs leading-5 text-muted-foreground">
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
            </>
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

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
