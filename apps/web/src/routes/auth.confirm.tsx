import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandLogo } from "@/components/BrandLogo";
import { supabase } from "@/integrations/everlumen/client";
import { authErrorMessage } from "@/lib/auth-errors";

/*
 * The landing page for every link we email: confirm your address, magic link,
 * password reset, email change.
 *
 * These links used to point straight at `https://<ref>.supabase.co/auth/v1/
 * verify`, which meant the customer's address bar filled with an unbranded
 * supabase.co subdomain at the exact moment we were asking them to trust us.
 * Worse, /verify spends the token on a plain GET, so link prescanners (Outlook
 * Safe Links, corporate mail AV, spam filters that fetch URLs to grade them)
 * burned it before the human clicked and the human was then told their
 * brand-new email had expired.
 *
 * Exchanging the token here fixes both. A prescanner fetching this URL just
 * loads a React page - the token is only spent once `verifyOtp` runs in a real
 * browser - and the only host anyone sees is ours.
 */

/** What `verifyOtp` will accept. Anything else came from a hand-edited URL. */
const OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change"] as const;

function isOtpType(value: unknown): value is EmailOtpType {
  return typeof value === "string" && (OTP_TYPES as readonly string[]).includes(value);
}

export const Route = createFileRoute("/auth/confirm")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { token_hash?: string; type?: string; next?: string } => ({
    token_hash: typeof search.token_hash === "string" ? search.token_hash : undefined,
    type: typeof search.type === "string" ? search.type : undefined,
    /*
     * Relative paths only. This page runs before the user has any say in where
     * they land, so an absolute `next` would make every confirmation email an
     * open redirect we mailed out ourselves.
     */
    next:
      typeof search.next === "string" &&
      search.next.startsWith("/") &&
      !search.next.startsWith("//")
        ? search.next
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Confirming your email - Everlumen" },
      // Nothing here is worth indexing and the URL carries a token.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const navigate = useNavigate();
  const { token_hash, type, next } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  /*
   * The token is single-use, so this must run exactly once. React's StrictMode
   * mounts effects twice in development: without the guard the second exchange
   * fails on an already-spent token and shows "this link has expired" on a
   * confirmation that actually worked.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!token_hash || !isOtpType(type)) {
      setError("This confirmation link is incomplete. Please open the link from your email again.");
      return;
    }

    void (async () => {
      const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash, type });

      if (verifyError) {
        console.error("[auth/confirm] verify failed", verifyError);
        setError(
          authErrorMessage(verifyError, "That link is no longer valid. Please request a new one."),
        );
        /*
         * Drop the spent token out of the URL so it does not sit in history or
         * get pasted into a support ticket. Success navigates away below, which
         * replaces the entry anyway.
         */
        void navigate({ to: "/auth/confirm", search: {}, replace: true });
        return;
      }

      // `replace` so Back does not return to a URL whose token is now spent.
      navigate({ to: (next || "/dashboard") as "/dashboard", replace: true });
    })();
  }, [token_hash, type, next, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-subtle px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <BrandLogo size={40} />
          <span className="text-lg font-bold">
            Ever<span className="text-primary">lumen</span>
          </span>
        </Link>
        <Card className="p-8 shadow-elegant">
          {error ? (
            <>
              <h1 className="text-2xl font-bold">We couldn't confirm that link</h1>
              <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                Confirmation links expire after an hour and can only be used once. Sign in and we
                will send you a fresh one.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link to="/login">Go to sign in</Link>
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold">Confirming your email</h1>
              <p className="mt-1 text-sm text-muted-foreground">This only takes a moment.</p>
              <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
