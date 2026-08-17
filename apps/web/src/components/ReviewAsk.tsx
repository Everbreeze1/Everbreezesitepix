import { ArrowRight, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReviewAskLink {
  url: string;
  label: string | null;
  platform: string;
}

/**
 * "How did we do?" - the ask, at the bottom of a finished job report.
 *
 * The client's framing is what sets the weight of this component: "the people
 * at this tier level will also ask for reviews from their customers when they
 * send them job reports… I think job reports are the only communication to the
 * customers. So it should be there for us to sell it."
 *
 * That is worth taking literally. The shared report is the one artefact a
 * customer ever receives, opened in the hour after the work was finished and
 * they were happy with it. Every review this business will ever get has to be
 * asked for on this page, so the ask is a full-width band with a real headline
 * and a one-tap button, not a link under the fold.
 *
 * Hidden from print and PDF on purpose - a star button on paper is a dead end,
 * and the PDF is what gets filed with the invoice.
 */
export function ReviewAsk({
  links,
  companyName,
  className,
}: {
  links: ReviewAskLink[];
  companyName?: string | null;
  className?: string;
}) {
  if (links.length === 0) return null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card text-center print:hidden",
        className,
      )}
    >
      <div className="px-6 py-10 sm:px-10">
        <div className="mx-auto flex w-fit gap-1 text-amber-400" aria-label="Five stars" role="img">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-6 w-6 fill-current" />
          ))}
        </div>

        <h2 className="mt-4 text-balance font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Happy with the work?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          A review takes about a minute and makes a real difference to
          {companyName?.trim() ? ` ${companyName.trim()}` : " a small business"}. Thank you.
        </p>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {links.map((link, i) => (
            <a
              key={`${link.url}-${i}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition",
                // The first link is the one they configured first, which after
                // connecting a listing is always Google. It gets the solid
                // button; the rest are alternates, not equals.
                i === 0
                  ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  : "border border-border text-foreground hover:border-foreground/40",
              )}
            >
              {link.platform === "google" && <GoogleMark />}
              {buttonLabel(link)}
              <ArrowRight className="h-4 w-4" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Naming the platform beats "Leave a review": a customer who already has a
 * Google account signed in on that phone knows the next tap is one they can
 * finish, which is most of the drop-off.
 */
function buttonLabel(link: ReviewAskLink): string {
  if (link.platform === "google") return "Review us on Google";
  if (link.platform === "nicejob") return "Review us on NiceJob";
  const label = link.label?.trim();
  return label ? `Review us on ${label}` : "Leave a review";
}

/** The Google G, inline so a customer's email client fetches nothing extra. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z"
      />
      <path
        fill="#34A853"
        d="M24 46c6 0 11-2 14.5-5.2l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7A22 22 0 0 0 24 46z"
      />
      <path fill="#FBBC05" d="M11.8 28.4a13 13 0 0 1 0-8.4v-5.7H4.5a22 22 0 0 0 0 19.8l7.3-5.7z" />
      <path
        fill="#EA4335"
        d="M24 9.5c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3A22 22 0 0 0 4.5 14.3l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
      />
    </svg>
  );
}
