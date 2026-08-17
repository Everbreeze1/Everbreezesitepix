import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Lightbulb, Loader2, Send, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  DWELL_MS,
  beginFeedbackSession,
  canPrompt,
  featureForPath,
  logPromptEvent,
  markFeatureAnswered,
  markPromptDismissed,
  markPromptShown,
  submitFeedback,
  type FeedbackKind,
} from "@/lib/feedback";

type Step = "ask" | "detail" | "done";

/**
 * An occasional, contextual nudge: after the user has actually spent time on a
 * feature, ask once how it is going. One tap answers it; anything more is
 * optional.
 *
 * Deliberately conservative - see the cadence rules in lib/feedback.ts. It asks
 * about a given feature at most once ever, at most once per session, never
 * within COOLDOWN_DAYS of the last prompt, and backs off for two sessions if
 * dismissed. The point is to catch problems testing misses and gauge which
 * features people care about, not to harvest engagement.
 */
export function FeedbackPrompt() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>("ask");
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feature, setFeature] = useState<{ key: string; label: string } | null>(null);

  /** One prompt per session, regardless of how much they navigate. */
  const shownThisSession = useRef(false);

  useEffect(() => {
    if (user?.id) beginFeedbackSession(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || visible || shownThisSession.current) return;
    const match = featureForPath(pathname);
    if (!match || !canPrompt(user.id, match.key)) return;

    // Dwell timer resets on navigation: the prompt only fires if they actually
    // stayed on the surface, not if they passed through it.
    const timer = window.setTimeout(() => {
      if (shownThisSession.current) return;
      shownThisSession.current = true;
      setFeature(match);
      setStep("ask");
      setMessage("");
      setVisible(true);
      markPromptShown(user.id);
      // The denominator for every rate below.
      logPromptEvent(user.id, match.key, "shown");
    }, DWELL_MS);

    return () => window.clearTimeout(timer);
  }, [pathname, user?.id, visible]);

  if (!visible || !feature || !user) return null;

  const close = () => setVisible(false);

  /** Both the X and "Not now" land here - declining is declining either way. */
  const dismiss = () => {
    markPromptDismissed(user.id);
    logPromptEvent(user.id, feature.key, "dismissed");
    close();
  };

  const send = async (nextKind: FeedbackKind, sentiment: "good" | "bad" | null, text: string) => {
    setSending(true);
    try {
      await submitFeedback({
        kind: nextKind,
        message: text,
        feature: feature.key,
        sentiment,
        source: "prompt",
        userId: user.id,
        email: user.email ?? null,
      });
      markFeatureAnswered(user.id, feature.key);
      logPromptEvent(user.id, feature.key, "answered");
      setStep("done");
      window.setTimeout(close, 2200);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send that - try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Quick feedback"
      className={cn(
        // Sits above the camera FAB (bottom-6 / bottom-[safe+5.5rem]) rather
        // than on top of it, and below dialogs at z-50.
        "fixed right-4 z-40 w-[min(22rem,calc(100vw-2rem))]",
        "bottom-[calc(env(safe-area-inset-bottom)+10rem)] md:bottom-24",
        "rounded-2xl border border-border bg-card p-4 shadow-2xl",
        "duration-300 animate-in slide-in-from-bottom-4 fade-in",
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      {step === "done" ? (
        <div className="py-2 pr-6">
          <p className="text-sm font-bold text-foreground">Thanks - that helps.</p>
          <p className="mt-1 text-xs text-muted-foreground">We read every one of these.</p>
        </div>
      ) : step === "ask" ? (
        <div className="pr-6">
          <p className="text-sm font-bold text-foreground">
            How&rsquo;s {feature.label} working for you?
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            One tap. We&rsquo;ll only ask about this once.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={sending}
              onClick={() => void send("praise", "good", "")}
            >
              <ThumbsUp className="mr-1.5 h-3.5 w-3.5" /> Good
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={sending}
              onClick={() => {
                setKind("bug");
                setStep("detail");
              }}
            >
              <ThumbsDown className="mr-1.5 h-3.5 w-3.5" /> Something&rsquo;s off
            </Button>
          </div>
          <button
            type="button"
            onClick={() => {
              setKind("idea");
              setStep("detail");
            }}
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            <Lightbulb className="h-3.5 w-3.5" /> I have an idea for this
          </button>
        </div>
      ) : (
        <div className="pr-6">
          <p className="text-sm font-bold text-foreground">
            {kind === "idea" ? "What would you like to see?" : "What went wrong?"}
          </p>
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={
              kind === "idea"
                ? `What would make ${feature.label} better?`
                : "The more detail, the faster we can fix it…"
            }
            className="mt-2 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={sending}>
              Not now
            </Button>
            <Button
              size="sm"
              disabled={sending || !message.trim()}
              onClick={() => void send(kind, kind === "bug" ? "bad" : null, message)}
            >
              {sending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
