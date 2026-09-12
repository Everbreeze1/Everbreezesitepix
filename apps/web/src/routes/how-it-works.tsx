import { createFileRoute, Link } from "@tanstack/react-router";
import { usePwaGuard } from "@/lib/pwa-guard";
import { Users, ShieldCheck, Bell, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { MarketingCta } from "@/components/MarketingCta";
import collaborationImg from "@/assets/collaboration-image.png";
import siteAerialImg from "@/assets/how-it-works-aerial.png";

export const Route = createFileRoute("/how-it-works")({
  component: HowItWorksPage,
  head: () => ({
    meta: [
      { title: "How It Works - Everlumen" },
      {
        name: "description",
        content:
          "Everlumen fits the way crews already work. Snap a photo on site, let it organize itself, then share a clean gallery or report - no new process to learn.",
      },
      { property: "og:title", content: "How It Works - Everlumen" },
      {
        property: "og:description",
        content:
          "Everlumen fits the way crews already work. Snap a photo on site, let it organize itself, then share a clean gallery or report - no new process to learn.",
      },
      { property: "og:url", content: "https://www.everlumen.co/how-it-works" },
    ],
    links: [{ rel: "canonical", href: "https://www.everlumen.co/how-it-works" }],
  }),
});

const steps = [
  {
    step: "01",
    title: "Snap it on site",
    desc: "Open Everlumen, take the photo or record a walkthrough. It is stamped with time, date and location the moment you capture it.",
  },
  {
    step: "02",
    title: "It organizes itself",
    desc: "Every photo lands on the right project automatically - sorted, searchable and mapped without a single tap of admin work.",
  },
  {
    step: "03",
    title: "Share & report",
    desc: "Send a clean gallery to a client, or let AI draft the progress report. Everyone stays aligned, no group chats required.",
  },
];

const collaborationPoints = [
  {
    icon: Users,
    title: "One source of truth",
    desc: "Office and field see the same projects, live. Shared workspaces keep everyone on the same page.",
  },
  {
    icon: ShieldCheck,
    title: "Role-based access",
    desc: "Give clients a curated gallery, subs their scope, and admins the full picture - with permissions you control.",
  },
  {
    icon: Bell,
    title: "Real-time updates",
    desc: "Assign tasks, track status and get notified the moment something changes on any active job.",
  },
];

function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background landing">
      <SiteHeader />

      {/* Header - the navy band, same look as the homepage How it works section */}
      <section className="relative overflow-hidden bg-sidebar">
        <div className="relative mx-auto max-w-[820px] px-4 pt-[70px] pb-14 text-center sm:px-8">
          <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-brand-gold">
            How it works
          </p>
          <h1 className="font-display mx-auto mt-5 text-[40px] font-bold leading-[1.04] tracking-[-0.01em] text-white">
            Capture. Organize. Report.
          </h1>
          <p className="font-manrope mx-auto mt-5 max-w-xl text-[15.5px] leading-[1.6] text-white/60">
            Everlumen fits the way crews already work. No new process to learn - just open the
            app and capture.
          </p>
        </div>
      </section>

      {/* Steps - the navy band with three steps, same as the homepage */}
      <section className="bg-sidebar py-24">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-8">
          <div className="grid gap-6 md:grid-cols-3 lg:gap-x-8">
            {/* Step 1: Capture */}
            <div className="flex flex-col">
              <div className="relative h-[200px] w-full overflow-hidden rounded-[16px] bg-gradient-to-br from-[#2b3350] to-[#171b2c]">
                <img
                  src="/capture-image.png"
                  alt="Capture a photo on site - automatically stamped with time, date and location"
                  className="h-full w-full object-cover opacity-70"
                />

              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gold font-manrope text-[13px] font-bold text-sidebar">1</span>
                <h3 className="font-manrope text-base font-semibold text-white">Capture</h3>
              </div>
              <p className="font-manrope mt-3 max-w-[280px] text-[13.5px] leading-[1.55] text-white/60">
                Snap a photo or record a walkthrough. It is stamped with time, date, and location automatically.
              </p>
            </div>

            {/* Step 2: Organize */}
            <div className="flex flex-col">
              <div className="relative h-[200px] w-full overflow-hidden rounded-[16px] bg-gradient-to-br from-[#2b3350] to-[#171b2c]">
                <img
                  src="/organize-image.png"
                  alt="Photos organized automatically into the right project, sorted and searchable"
                  className="h-full w-full object-cover opacity-70"
                />

              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gold font-manrope text-[13px] font-bold text-sidebar">2</span>
                <h3 className="font-manrope text-base font-semibold text-white">Organize</h3>
              </div>
              <p className="font-manrope mt-3 max-w-[280px] text-[13.5px] leading-[1.55] text-white/60">
                Every photo lands on the right project automatically - sorted, searchable, and mapped.
              </p>
            </div>

            {/* Step 3: Report */}
            <div className="flex flex-col">
              <div className="relative h-[200px] w-full overflow-hidden rounded-[16px] bg-gradient-to-br from-[#2b3350] to-[#171b2c]">
                <img
                  src="/report-image.png"
                  alt="AI-generated progress report drafted from your site photos"
                  className="h-full w-full object-cover opacity-70"
                />

              </div>
              <div className="mt-5 flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gold font-manrope text-[13px] font-bold text-sidebar">3</span>
                <h3 className="font-manrope text-base font-semibold text-white">Report</h3>
              </div>
              <p className="font-manrope mt-3 max-w-[280px] text-[13.5px] leading-[1.55] text-white/60">
                AI drafts your progress report. Review, edit, and share with one tap.
              </p>
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <Button
              asChild
              className="font-manrope rounded-full border-2 border-white/40 bg-transparent px-7 py-[13px] text-[14.5px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Link to="/demo">
                See the interactive demo <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Site photo */}
      <section className="pb-24">
        <div className="mx-auto max-w-[1280px] px-8">
          <div className="aspect-[1216/520] w-full overflow-hidden rounded-[32px]">
            <img
              src={siteAerialImg}
              alt="Aerial view of an organized, active construction site"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Collaboration */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-[1280px] px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="aspect-[580/600] w-full overflow-hidden rounded-[32px] lg:h-[600px]">
              <img
                src={collaborationImg}
                alt="Two construction professionals collaborating over a tablet on site"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                Collaboration
              </p>
              <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-0.01em] text-foreground sm:text-5xl">
                The whole crew, finally in sync.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-lg leading-[29px] text-muted-foreground">
                From the superintendent to the office to the client, everyone works from the same
                up-to-date project - no forwarding, no group chats, no guessing what happened on
                site.
              </p>
              <ul className="mt-10 space-y-6">
                {collaborationPoints.map((p) => (
                  <li key={p.title} className="flex gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                      <p.icon className="h-5 w-5 text-primary" />
                    </span>
                    <div>
                      <h3 className="font-manrope text-lg font-semibold text-foreground">
                        {p.title}
                      </h3>
                      <p className="font-manrope mt-1 text-base leading-[26px] text-muted-foreground">
                        {p.desc}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <MarketingCta />
      <SiteFooter />
    </div>
  );
}

