import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Users, CheckCircle2, AlertCircle, LogIn, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/PasswordInput";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/sitepix/client";
import { lookupInvite, acceptInvite, acceptInviteSignup } from "@/lib/teams.functions";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({ meta: [{ title: "Accept invite — SitePix" }] }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const lookup = lookupInvite;
  const accept = acceptInvite;
  const acceptSignup = acceptInviteSignup;

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
        const res: any = await lookup({ data: { token } });
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
  }, [token, lookup]);

  const doSignupAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    if (fullName.trim().length < 1) {
      setMessage("Please enter your full name.");
      return;
    }

    setSubmitting(true);
    try {
      const res: any = await acceptSignup({ data: { token, fullName: fullName.trim(), password } });
      // Auto sign-in
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
      await accept({ data: { token } });
      setState("accepted");
      setTimeout(() => navigate({ to: "/projects" }), 900);
    } catch (e: any) {
      setMessage(e?.message ?? "Failed to accept invite");
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo size={40} />
        </div>

        <Card className="p-6 md:p-8 transition hover:border-primary/50 hover:shadow-elegant">
          {state === "loading" && (
            <div className="flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading invite…
            </div>
          )}

          {state === "ready" && invite && team && (
            <>
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="h-7 w-7" />
                </div>
              </div>
              <h1 className="mt-4 text-center text-2xl font-bold">Join {team.name}</h1>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                You've been invited as a{" "}
                <span className="capitalize font-medium">{invite.role}</span>. You'll get access to
                all of {team.name}'s projects, photos, and reports.
              </p>

              <div className="mt-6">
                {loading ? (
                  <div className="text-center text-sm text-muted-foreground">Checking session…</div>
                ) : user && user.email?.toLowerCase() === invite.email.toLowerCase() ? (
                  <div className="space-y-3">
                    <p className="text-center text-sm text-muted-foreground">
                      Signed in as <strong>{user.email}</strong>
                    </p>
                    <Button
                      onClick={doAcceptExisting}
                      disabled={submitting}
                      className="w-full"
                      size="lg"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Joining…
                        </>
                      ) : (
                        `Accept and join ${team.name}`
                      )}
                    </Button>
                    {message && <p className="text-center text-sm text-destructive">{message}</p>}
                  </div>
                ) : user ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                      You're signed in as <strong>{user.email}</strong>, but this invite is for{" "}
                      <strong>{invite.email}</strong>.
                    </div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={async () => {
                        await supabase.auth.signOut();
                      }}
                    >
                      Sign out and continue
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={doSignupAndAccept} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" value={invite.email} disabled readOnly />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="fullName">Full name</Label>
                      <Input
                        id="fullName"
                        autoFocus
                        autoComplete="name"
                        placeholder="Jane Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Create password</Label>
                      <PasswordInput
                        id="password"
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm password</Label>
                      <PasswordInput
                        id="confirmPassword"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                      />
                    </div>

                    {message && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                        {message}
                      </div>
                    )}

                    <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating your account…
                        </>
                      ) : (
                        <>Create account & join {team.name}</>
                      )}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                      Already have an account with {invite.email}?{" "}
                      <Link
                        to="/login"
                        search={{ redirect: `/invite/${token}` } as any}
                        className="text-primary hover:underline"
                      >
                        <LogIn className="inline h-3 w-3 mr-0.5" /> Sign in instead
                      </Link>
                    </p>
                  </form>
                )}
              </div>
            </>
          )}

          {state === "accepted" && (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
              <h2 className="mt-3 text-xl font-semibold">You're in!</h2>
              <p className="mt-1 text-sm text-muted-foreground">Redirecting to your projects…</p>
            </div>
          )}

          {(state === "invalid" || state === "error") && (
            <div className="text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
              <h2 className="mt-3 text-xl font-semibold">Invite unavailable</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {message || "Please ask for a new invite."}
              </p>
              <Button asChild variant="outline" className="mt-4">
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
