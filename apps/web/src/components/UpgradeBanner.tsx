import { Link } from "@tanstack/react-router";
import { Loader2, Sparkles } from "lucide-react";

/** Persistent, non-blocking reminder shown across the app for accounts
 * without an active subscription — replaces the old hard redirect-to-
 * /pricing so people can still browse everything, they just can't create
 * or upload until they subscribe. */
export function UpgradeBanner({ activating = false }: { activating?: boolean }) {
  if (activating) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        Activating your subscription…
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 shrink-0" />
        You're viewing SitePix without an active plan — creating and uploading are paused.
      </span>
      <Link to="/pricing" className="font-bold underline underline-offset-2">
        View plans
      </Link>
    </div>
  );
}
