import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, ArrowRight, ArrowLeft } from "lucide-react";
import { authErrorMessage, isUnconfirmedEmail } from "@/lib/auth-errors";
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
import loginImg from "@/assets/collaboration-image.png";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect:
      typeof search.redirect === "string" &&
      search.redirect.startsWith("/") &&
      !search.redirect.startsWith("//")
        ? search.redirect
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Everbreeze SitePix" },
      {
        name: "description",
        content:
          "Sign in to Everbreeze SitePix to access your construction job site photos, projects, AI analyses, and Breeze assistant.",
      },
      { property: "og:title", content: "Sign in — Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "Sign in to Everbreeze SitePix to access your construction job site photos, projects, AI analyses, and Breeze assistant.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/login" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/login" }],
  }),
  component: LoginPage,
});

const highlights = [
  "Photos sorted by job automatically",
  "Live updates from every active site",
  "Share ready-to-send client reports",
];

const inputClass =
  "mt-2 h-[46px] rounded-lg border-[0.8px] border-border bg-card px-4 font-manrope text-sm text-foreground placeholder:text-[#9CA3AF] focus-visible:border-primary focus-visible:ring-ring/30";

function LoginPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);

  /*
   * Same normalisation as signup. Without it an account created as
   * "A@B.com " cannot be logged into by typing "a@b.com", and the error the
   * user sees is "incorrect email or password" — which sends them to reset a
   * password that was never wrong.
   */
  const cleanEmail = email.trim().toLowerCase();

  // Only offer social buttons the project has actually enabled.
  const social = useAuthProviders();

  useEffect(() => {
    if (user) navigate({ to: (redirect || "/dashboard") as "/dashboard", replace: true });
  }, [user, navigate, redirect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setNeedsVerification(false);
    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    setLoading(false);
    if (error) {
      if (isUnconfirmedEmail(error)) {
        setNeedsVerification(true);
        return toast.error("Please verify your email before signing in.");
      }
      // Everything else goes through the shared mapper, so an unparseable
      // error can no longer reach the user as `{}`.
      console.error("[login] failed", error);
      return toast.error(authErrorMessage(error));
    }
    toast.success("Welcome back!");
  };

  const handleResend = async () => {
    if (!cleanEmail) return toast.error("Enter your email first.");
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: cleanEmail,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setResending(false);
    if (error) {
      console.error("[login] resend failed", error);
      return toast.error(authErrorMessage(error));
    }
    toast.success("Verification email sent. Check your inbox.");
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${redirect || "/dashboard"}` },
    });
    if (error) {
      console.error("[login] oauth failed", error);
      toast.error(authErrorMessage(error, `${provider} sign-in failed`));
    }
  };

  const handleForgot = async () => {
    if (!cleanEmail) return toast.error("Enter your email first to reset password.");
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      console.error("[login] reset request failed", error);
      return toast.error(authErrorMessage(error));
    }
    toast.success("Password reset email sent. Check your inbox.");
  };

  return (
    <div className="min-h-screen w-full bg-background lg:grid lg:grid-cols-2">
      {/* LEFT — marketing panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between">
        {/* Background rather than <img> — see signup.tsx. `hidden lg:flex` does
            not stop an <img src> downloading, so this 606 KB decoration was
            being fetched on every phone that opened the login page. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-35"
          style={{ backgroundImage: `url(${loginImg})` }}
        />
        <div className="absolute inset-0 bg-sidebar/75" />

        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandLogo size={40} />
            <span className="font-manrope text-lg font-extrabold tracking-[-0.45px] text-sidebar-foreground">
              Everbreeze <span className="text-sidebar-ring">SitePix</span>
            </span>
          </Link>

          <div className="max-w-[448px]">
            <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.92px] text-sidebar-ring">
              Field-ready documentation
            </p>
            <h1 className="font-display mt-4 text-5xl font-black uppercase leading-[0.9] tracking-[-2.1px] text-sidebar-foreground xl:text-6xl">
              Know what happened. <span className="text-sidebar-ring">Prove it.</span>
            </h1>
            <p className="font-manrope mt-6 text-base leading-7 text-sidebar-foreground/70">
              Photos, walkthroughs, reports, and your project history — all in the same place.
            </p>
            <ul className="mt-8 space-y-3">
              {highlights.map((h) => (
                <li key={h} className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-sidebar-ring" />
                  <span className="font-manrope text-sm font-bold text-sidebar-foreground/85">
                    {h}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="font-manrope text-xs text-sidebar-foreground/45">
            © {new Date().getFullYear()} Everbreeze SitePix
          </p>
        </div>
      </aside>

      {/* RIGHT — form */}
      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-8 lg:justify-center lg:px-12 lg:py-12">
        <div className="mb-6 flex items-center justify-between lg:hidden">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-[448px] flex-1 flex-col justify-center lg:flex-none">
          <MobileAppBanner />

          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <BrandLogo size={44} />
            <div className="mt-3 flex items-baseline gap-1.5 text-xl font-bold tracking-tight">
              <span className="text-foreground">Everbreeze</span>
              <span className="text-primary">SitePix</span>
            </div>
          </div>

          <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.92px] text-primary">
            Welcome back
          </p>
          <h2 className="font-display mt-3 text-4xl font-black uppercase leading-[0.92] tracking-[-1.68px] text-foreground sm:text-5xl">
            Back to the work.
          </h2>
          <p className="font-manrope mt-4 text-sm leading-6 text-muted-foreground">
            Log in to see what is moving across your projects.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <Label htmlFor="email" className="font-manrope text-sm font-bold text-foreground">
                Work email
              </Label>
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
                className={inputClass}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="password"
                  className="font-manrope text-sm font-bold text-foreground"
                >
                  Password
                </Label>
                <button
                  type="button"
                  onClick={handleForgot}
                  className="font-manrope text-xs font-bold text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <PasswordInput
                id="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="font-manrope h-12 w-full rounded-lg bg-primary text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              {loading ? (
                "Logging in…"
              ) : (
                <>
                  Log in to SitePix <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          {needsVerification && (
            <div className="mt-4 rounded-md border-[0.8px] border-border bg-card/60 p-3 text-sm">
              <p className="font-manrope text-muted-foreground">
                Your email isn't verified yet. We can send another link.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? "Sending…" : "Resend verification email"}
              </Button>
            </div>
          )}

          {social.any && (
            <>
              <div className="mt-7 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="font-manrope text-xs text-muted-foreground">or continue with</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="mt-7 grid gap-2.5">
                {social.has("google") && (
                  <button
                    type="button"
                    onClick={() => handleOAuth("google")}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border-[0.8px] border-[#DAE2EA] bg-[#F9FCFF] font-manrope text-sm font-bold text-[#0B1C2C] shadow-sm hover:bg-[#F0F6FC]"
                  >
                    <GoogleIcon /> Continue with Google
                  </button>
                )}
                {social.has("apple") && (
                  <button
                    type="button"
                    onClick={() => handleOAuth("apple")}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border-[0.8px] border-[#DAE2EA] bg-[#F9FCFF] font-manrope text-sm font-bold text-[#0B1C2C] shadow-sm hover:bg-[#F0F6FC]"
                  >
                    <AppleIcon /> Continue with Apple
                  </button>
                )}
              </div>
            </>
          )}

          <p className="font-manrope mt-7 text-center text-sm text-muted-foreground">
            New to SitePix?{" "}
            <Link to="/signup" className="font-bold text-primary hover:underline">
              Sign up
            </Link>
          </p>
          <p className="font-manrope mt-4 text-center text-xs leading-5 text-muted-foreground">
            By continuing, you agree to our{" "}
            <Link to="/terms-of-service" className="hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy-policy" className="hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        <div className="mt-8 text-center text-xs text-muted-foreground lg:hidden">
          © {new Date().getFullYear()} Everbreeze SitePix
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
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
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#0B1C2C">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
