import { useState } from "react";
import { Bug, Lightbulb, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { submitFeedback, type FeedbackKind } from "@/lib/feedback";

/** The two things people actually come here to do. */
const MODES: Array<{
  kind: Extract<FeedbackKind, "bug" | "idea">;
  tab: string;
  icon: typeof Bug;
  banner: string;
  bannerHint: string;
  label: string;
  placeholder: string;
  cta: string;
  thanks: string;
}> = [
  {
    kind: "bug",
    tab: "Report a problem",
    icon: Bug,
    banner: "A clear field note helps us move faster.",
    bannerHint: "Include the project, device, and steps you were taking.",
    label: "What went wrong?",
    placeholder: "Tell us what you were trying to do and what happened…",
    cta: "Send report",
    thanks: "Thanks — our team has been notified.",
  },
  {
    kind: "idea",
    tab: "Suggest a feature",
    icon: Lightbulb,
    banner: "Tell us what would make SitePix better.",
    bannerHint: "What are you doing by hand today that we could do for you?",
    label: "What would you like to see?",
    placeholder: "Describe the feature and what it would let you do…",
    cta: "Send suggestion",
    thanks: "Thanks — every suggestion gets read.",
  },
];

export function ReportIssuePage() {
  const { user } = useAuth();
  const [kind, setKind] = useState<"bug" | "idea">("bug");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const mode = MODES.find((m) => m.kind === kind)!;

  const submit = async () => {
    if (!message.trim()) {
      toast.error(kind === "bug" ? "Please describe the issue." : "Please describe your idea.");
      return;
    }
    setSubmitting(true);
    try {
      await submitFeedback({
        kind,
        message,
        source: "page",
        userId: user?.id ?? null,
        email: user?.email ?? null,
      });
      toast.success(mode.thanks);
      setMessage("");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send that — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-10">
      <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
        Support
      </p>
      <h1 className="font-display mt-3 text-[38.4px] font-bold leading-9 tracking-[-1.34px] text-foreground">
        Share feedback
      </h1>
      <p className="font-manrope mt-3 max-w-[576px] text-sm leading-6 text-muted-foreground">
        Report something that&rsquo;s broken, or tell us what to build next. Both go straight to
        the team.
      </p>

      <div className="mt-6 inline-flex rounded-xl border border-border bg-card p-1">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = m.kind === kind;
          return (
            <button
              key={m.kind}
              type="button"
              onClick={() => setKind(m.kind)}
              className={cn(
                "font-manrope inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {m.tab}
            </button>
          );
        })}
      </div>

      <div className="mt-5 overflow-hidden rounded-[24px] border-[0.8px] border-border bg-card/[0.82]">
        <div className="bg-sidebar px-6 py-5">
          <p className="font-manrope text-sm font-extrabold text-sidebar-foreground">
            {mode.banner}
          </p>
          <p className="font-manrope mt-1 text-xs text-sidebar-foreground/60">{mode.bannerHint}</p>
        </div>

        <div className="p-6">
          <label
            htmlFor="feedback-message"
            className="font-manrope text-sm font-extrabold text-foreground"
          >
            {mode.label}
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            maxLength={4000}
            placeholder={mode.placeholder}
            className="font-manrope mt-2 w-full resize-none rounded-2xl border-[0.8px] border-border bg-card/[0.92] px-4 py-3 text-sm text-foreground shadow-[0px_5px_12px_-12px_rgba(16,25,41,0.35)] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
          />

          <button
            type="button"
            onClick={submit}
            disabled={submitting || !message.trim()}
            className="font-manrope mt-6 flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {mode.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
