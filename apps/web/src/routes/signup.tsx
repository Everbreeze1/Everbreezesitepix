import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CircleCheck, ArrowRight } from "lucide-react";
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
      { property: "og:url", content: "https://everbreezesitepix.com/signup" },
    ],
    links: [{ rel: "canonical", href: "https://everbreezesitepix.com/signup" }],
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

  useEffect(() => {
    if (user) navigate({ to: "/dashboard", replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (!data.session) {
      // Email confirmation is required — no session yet, so the auth-state
      // redirect below never fires. Tell the user what to actually do next.
      setConfirmEmailSent(true);
      toast.success("Check your email to confirm your account.");
      return;
    }
    toast.success("Account created! Redirecting…");
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) toast.error(error.message ?? `${provider} sign-in failed`);
  };

  return (
    <div className="min-h-screen w-full bg-background lg:grid lg:grid-cols-2">
      {/* LEFT — marketing panel (desktop only) */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <img
          src={heroImg}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
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
              <Input
                id="email"
                type="email"
                required
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
              <PasswordInput
                id="password"
                required
                minLength={8}
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

          <div className="mt-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="font-manrope text-xs text-muted-foreground">or continue with</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="mt-7 grid gap-2.5">
            <Button
              type="button"
              onClick={() => handleOAuth("google")}
              variant="outline"
              className="h-10 w-full rounded-lg border-[#DAE2EA] bg-[#F9FCFF] font-manrope text-sm font-bold text-[#0B1C2C] shadow-sm hover:bg-[#F0F5FB]"
            >
              <GoogleIcon /> Continue with Google
            </Button>
            <Button
              type="button"
              onClick={() => handleOAuth("apple")}
              variant="outline"
              className="h-10 w-full rounded-lg border-[#DAE2EA] bg-[#F9FCFF] font-manrope text-sm font-bold text-[#0B1C2C] shadow-sm hover:bg-[#F0F5FB]"
            >
              <AppleIcon /> Continue with Apple
            </Button>
          </div>

          <p className="font-manrope mt-7 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-bold text-primary hover:underline">
              Log in
            </Link>
          </p>
          <p className="font-manrope mt-4 text-center text-xs leading-5 text-muted-foreground">
            By continuing, you agree to our Terms of Service and{" "}
            <Link to="/privacy-policy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
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
