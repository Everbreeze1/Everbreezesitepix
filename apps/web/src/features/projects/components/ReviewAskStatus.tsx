import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Star } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { listReviewLinks } from "@/lib/review-links.functions";

/**
 * Tells the person about to send a report whether it will ask for a review.
 *
 * The client's reasoning, verbatim: "the people at this tier level will also
 * ask for reviews from their customers when they send them job reports… I think
 * job reports are the only communication to the customers. So it should be
 * there for us to sell it."
 *
 * The ask already renders on the shared page. What was missing is that nobody
 * building a report could tell - so a team with no review links kept sending
 * reports that quietly asked for nothing, and a team with them never learned
 * the feature was working for them. Both halves are handled here, at the moment
 * of sending, which is the only moment either fact is actionable.
 *
 * Silent on non-Team plans. This is a paid capability and the report builder is
 * not the place to interrupt someone mid-job with an upgrade pitch; the pricing
 * page and the Portfolio empty state already make that argument.
 */
export function ReviewAskStatus() {
  const { isTeam, loading: planLoading } = useSubscription();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isTeam) return;
    let cancelled = false;
    listReviewLinks()
      .then((res) => {
        if (!cancelled) setCount(res.links.length);
      })
      // A failed read means we cannot say either way, and guessing wrong in
      // public is worse than saying nothing: claiming a review button that
      // isn't there is how a contractor stops trusting the status line.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isTeam]);

  if (planLoading || !isTeam || count === null) return null;

  if (count === 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-xs">
        <Star className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-bold text-foreground">This report could ask for a review.</span>
        <span className="text-muted-foreground">It&rsquo;s the only page your customer opens.</span>
        <Link
          to="/showcases"
          className="ml-auto inline-flex items-center gap-1 font-bold text-primary underline-offset-4 hover:underline"
        >
          Connect Google <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    );
  }

  return (
    <p className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      Your customer sees a review button at the bottom of this report.
    </p>
  );
}
