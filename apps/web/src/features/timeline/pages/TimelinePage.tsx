import { Link } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useSubscription } from "@/hooks/use-subscription";
import { TimelineCalendar } from "@/features/timeline/components/TimelineCalendar";

/**
 * The company-wide timeline. Gated to Pro/Team as agreed — every project's own
 * timeline stays free on its project page, so this reads as an upgrade to a
 * feature you already use rather than a wall in front of a new one.
 */
export function TimelinePage() {
  const { isPro, loading } = useSubscription();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isPro) {
    return (
      <div className="p-6 sm:p-10">
        <PageHeader
          title="Timeline"
          description="See every job across your whole company, day by day."
        />
        <div className="mt-8 rounded-2xl border border-border bg-card/70 p-10 text-center">
          <Lock className="mx-auto h-9 w-9 text-muted-foreground/60" />
          <p className="mt-4 text-sm font-bold text-foreground">
            The company-wide Timeline is a Pro feature
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Every project already has its own timeline on its page. Upgrade to see all of them
            together and spot the gaps between jobs.
          </p>
          <Button asChild className="mt-5">
            <Link to="/pricing">See plans</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-10">
      <PageHeader
        title="Timeline"
        description="Every photo your crew took, laid out by the day it was taken."
      />
      <div className="mt-6">
        <TimelineCalendar />
      </div>
    </div>
  );
}
