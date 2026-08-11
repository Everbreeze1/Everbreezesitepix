import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "sitepix-install-dismissed-at";
const DISMISS_DAYS = 14;

/*
 * How long the banner stays up before retiring itself.
 *
 * It is a fixed overlay pinned above the mobile tab bar, so on a phone it sits
 * directly over whatever the page puts at the bottom of the screen — which on
 * every form in the app is the primary submit button. Nothing about the layout
 * reserves space for it, and there is no route where it is suppressed, so a
 * user who ignores it is left tapping through it until they think to dismiss it.
 *
 * Retiring after a short window bounds that without removing the feature: the
 * prompt is an upsell, and an upsell must never outlive the user's patience with
 * it. It does NOT write DISMISS_KEY on timeout, so it can come back on a later
 * visit rather than being suppressed for the full 14 days.
 */
const AUTO_RETIRE_MS = 15_000;

function isInIframe() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (navigator as any).standalone === true
  );
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isInIframe() || isStandalone()) return;

    const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (dismissed && Date.now() - dismissed < DISMISS_DAYS * 86400_000) return;

    setHidden(false);

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    if (isIOS()) {
      const t = window.setTimeout(() => setShowIOS(true), 4000);
      return () => {
        window.removeEventListener("beforeinstallprompt", onBIP);
        window.clearTimeout(t);
      };
    }
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  // Retire the banner once it has had its say, so it stops covering whatever is
  // underneath it. Starts only once something is actually on screen.
  useEffect(() => {
    if (hidden || (!deferred && !showIOS)) return;
    const t = window.setTimeout(() => setHidden(true), AUTO_RETIRE_MS);
    return () => window.clearTimeout(t);
  }, [hidden, deferred, showIOS]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDeferred(null);
    setShowIOS(false);
    setHidden(true);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "dismissed") dismiss();
    setDeferred(null);
  };

  if (hidden) return null;
  if (!deferred && !showIOS) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-6 md:right-6 md:left-auto md:mx-0"
      role="dialog"
      aria-label="Install SitePix"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Download className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Install SitePix</p>
          {deferred ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add to your home screen for one-tap access in the field.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tap <Share className="inline h-3.5 w-3.5 align-text-bottom" /> Share, then{" "}
              <strong>"Add to Home Screen"</strong>.
            </p>
          )}
          {deferred && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={install} className="h-8">
                Install
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss} className="h-8">
                Not now
              </Button>
            </div>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
