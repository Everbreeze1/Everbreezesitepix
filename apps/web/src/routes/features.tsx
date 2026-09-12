import { createFileRoute, Link } from "@tanstack/react-router";
import { usePwaGuard } from "@/lib/pwa-guard";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/features")({
  component: FeaturesPage,
  head: () => ({
    meta: [
      { title: "Features - Everlumen" },
      {
        name: "description",
        content:
          "Live site maps, recorded walkthroughs, an AI assistant, and zero-filing organization - everything it takes to document a job, in one record.",
      },
      { property: "og:title", content: "Features - Everlumen" },
      {
        property: "og:description",
        content:
          "Live site maps, recorded walkthroughs, an AI assistant, and zero-filing organization - everything it takes to document a job, in one record.",
      },
      { property: "og:url", content: "https://www.everlumen.co/features" },
    ],
    links: [{ rel: "canonical", href: "https://www.everlumen.co/features" }],
  }),
});

const FEATURES = [
  {
    pill: "bg-[oklch(0.9_0.06_190)] text-[oklch(0.38_0.1_190)]",
    label: "Live project context",
    title: "Live site map",
    body: "Every project pinned on one interactive map. See every active job, jump straight to the latest photos, and know exactly where your crews are without a single phone call.",
    points: [
      "Pin color shows job status at a glance (active, on hold, complete)",
      "Click any pin to jump straight into that project's latest activity",
      "Filter the map by crew, date range, or job type",
    ],
    image: "Map view - project pins",
  },
  {
    pill: "bg-[oklch(0.88_0.06_240)] text-[oklch(0.38_0.13_240)]",
    label: "Video documentation",
    title: "Recorded walkthroughs",
    body: "Record narrated video walkthroughs with audio, tied to the project timeline so anyone - office staff, a new PM, a client - can revisit the site without ever leaving their desk.",
    points: [
      "Audio narration captures context photos alone can't show",
      "Each walkthrough is timestamped and slots into the project timeline automatically",
      "Reusable walkthrough scripts keep every crew documenting the same way",
    ],
    image: "Walkthrough recorder",
  },
  {
    pill: "bg-[oklch(0.9_0.06_300)] text-[oklch(0.4_0.14_300)]",
    label: "Ask, investigate, locate",
    title: "AI assistant",
    body: "Ask the assistant what changed, what's still unresolved, and exactly where the evidence lives. Reports draft from that same project record - nothing gets re-typed from memory.",
    points: [
      "Answers are grounded in your actual timestamped photos and notes, not guesses",
      "One-tap report drafting, reviewed and edited before it goes out",
      "Workflows stay the structured, assigned-step process for sign-off - the assistant is for ad hoc questions",
    ],
    image: "AI assistant chat panel",
  },
  {
    pill: "bg-accent text-accent-foreground",
    label: "Zero filing",
    title: "Smart organization",
    body: "Every photo is timestamped, GPS-tagged, and auto-sorted by project the moment it's taken. No more scrolling camera rolls or digging through group chats to find one shot.",
    points: [
      "Search by project, date, tag, or location",
      "Bulk-import an existing camera roll and it sorts itself in",
      "Every photo keeps its original metadata, permanently",
    ],
    image: "Auto-sorted project gallery",
  },
];
function FeatureCopy(props: { feature: (typeof FEATURES)[number] }) {
  const feature = props.feature;
  return (
    <div>
      <span
        className={cn(
          "font-manrope inline-flex rounded-full px-[11px] py-1 text-[11.5px] font-bold",
          feature.pill,
        )}
      >
        {feature.label}
      </span>
      <h2 className="font-display mt-6 text-[32px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
        {feature.title}
      </h2>
      <p className="font-manrope mt-5 max-w-xl text-base leading-[26px] text-muted-foreground">
        {feature.body}
      </p>
      <ul className="mt-8 flex flex-col gap-2.5">
        {feature.points.map((point, i) => (
          <li
            key={i}
            className="flex items-start gap-2 font-manrope text-[14px] leading-snug text-muted-foreground"
          >
            <span>{"\u2014"}</span>
            <span className="min-w-0 flex-1">{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeaturePanel(props: { label: string }) {
  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[20px] bg-gradient-to-br from-[#2b3350] to-[#171b2c] font-manrope text-[13px] text-white/30">
      {props.label}
    </div>
  );
}

function FeatureRow(props: { feature: (typeof FEATURES)[number]; flip: boolean }) {
  const feature = props.feature;
  return (
    <section
      className={cn(props.flip ? "border-y border-border bg-muted py-24" : "bg-background py-24")}
    >
      <div className="mx-auto grid max-w-[1160px] items-center gap-16 px-4 sm:px-8 lg:grid-cols-2">
        {props.flip ? (
          <>
            <div className="order-2">
              <FeatureCopy feature={feature} />
            </div>
            <div className="order-1">
              <FeaturePanel label={feature.image} />
            </div>
          </>
        ) : (
          <>
            <div>
              <FeatureCopy feature={feature} />
            </div>
            <div>
              <FeaturePanel label={feature.image} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
function FeaturesPage() {
  usePwaGuard();
  return (
    <div className="min-h-screen bg-background landing">
      <SiteHeader />

      {/* Header - the mockup navy hero band */}
      <section className="relative overflow-hidden bg-sidebar">
        <div className="relative mx-auto max-w-[1160px] px-4 pt-24 pb-28 text-center sm:px-8">
          <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-brand-gold">
            Features
          </p>
          <h1 className="font-display mx-auto mt-6 max-w-3xl text-[40px] font-bold leading-[1.04] tracking-[-0.01em] text-sidebar-foreground sm:text-[44px]">
            Everything it takes to document a job, in one record.
          </h1>
          <p className="font-manrope mx-auto mt-6 max-w-2xl text-base leading-relaxed text-sidebar-foreground/70">
            From the first photo on site to the report your client reads, here's exactly what
            Everlumen does at each step.
          </p>
          <div className="mt-10 flex justify-center">
            <Button
              asChild
              size="lg"
              className="font-manrope rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Link to="/signup">
                Start free trial <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {FEATURES.map((feature, i) => (
        <FeatureRow key={feature.title} feature={feature} flip={i % 2 === 1} />
      ))}

      {/* Final CTA */}
      <section className="bg-muted py-24">
        <div className="mx-auto max-w-[1160px] px-4 py-24 text-center sm:px-8">
          <h2 className="font-display mx-auto max-w-2xl text-[32px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
            See it running on a real job.
          </h2>
          <p className="font-manrope mx-auto mt-6 text-base text-muted-foreground">
            14-day free trial, set up in minutes.
          </p>
          <div className="mt-10 flex justify-center">
            <Button
              asChild
              size="lg"
              className="font-manrope rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Link to="/signup">
                Start free trial <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-8">
            <Link
              to="/pricing"
              className="font-manrope text-sm font-semibold text-accent-foreground underline underline-offset-4"
            >
              Or compare plans first
            </Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
