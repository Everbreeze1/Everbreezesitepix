import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";

export function ReportIssuePage() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!message.trim()) {
      toast.error("Please describe the issue.");
      return;
    }
    setSubmitting(true);
    try {
      const url = typeof window !== "undefined" ? window.location.href : null;
      const userAgent = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null;
      const { error } = await supabase.from("issue_reports").insert({
        user_id: user?.id ?? null,
        email: user?.email ?? null,
        message: message.trim().slice(0, 4000),
        url,
        user_agent: userAgent,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Thanks — our team has been notified.");
      setMessage("");
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
        Report an issue
      </h1>
      <p className="font-manrope mt-3 max-w-[576px] text-sm leading-6 text-muted-foreground">
        Tell us what happened and we will get it to the right team.
      </p>

      <div className="mt-8 overflow-hidden rounded-[24px] border-[0.8px] border-border bg-card/[0.82]">
        <div className="bg-sidebar px-6 py-5">
          <p className="font-manrope text-sm font-extrabold text-sidebar-foreground">
            A clear field note helps us move faster.
          </p>
          <p className="font-manrope mt-1 text-xs text-sidebar-foreground/60">
            Include the project, device, and steps you were taking.
          </p>
        </div>

        <div className="p-6">
          <label
            htmlFor="issue-message"
            className="font-manrope text-sm font-extrabold text-foreground"
          >
            What went wrong?
          </label>
          <textarea
            id="issue-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            maxLength={4000}
            placeholder="Tell us what you were trying to do and what happened…"
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
            Send report
          </button>
        </div>
      </div>
    </div>
  );
}
