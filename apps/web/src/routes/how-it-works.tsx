import { createFileRoute } from "@tanstack/react-router";
import { usePwaGuard } from "@/lib/pwa-guard";
import { Users, ShieldCheck, Bell } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
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
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Header */}
      <section className="pt-32 pb-4 sm:pt-40">
        <div className="mx-auto max-w-[768px] px-5 text-center">
          <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
            How it works
          </p>
          <h1 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.4px] text-foreground sm:text-5xl sm:tracking-[-1.8px] lg:text-[60px] lg:tracking-[-2.1px]">
            Capture. Organize. <span className="text-primary">Report.</span>
          </h1>
          <p className="font-manrope mx-auto mt-6 max-w-xl text-lg leading-[29px] text-muted-foreground">
            Everlumen fits the way crews already work. No new process to learn - just open the app
            and capture.
          </p>
        </div>
      </section>

      {/* Steps - visual journey with product screenshots */}
      <section className="py-24">
        <div className="mx-auto max-w-[1280px] px-8">
          <div className="grid gap-8 md:grid-cols-3">
            {/* Step 1: Capture */}
            <div className="flex flex-col">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[24px] border-[0.8px] border-border bg-card">
                <img
                  src="/capture.png"
                  alt="Capture a photo on site - automatically stamped with time, date and location"
                  className="h-full w-full object-cover"
                />
                <div className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary font-manrope text-sm font-bold text-primary-foreground">
                  1
                </div>
              </div>
              <div className="mt-5">
                <h3 className="font-display text-xl font-semibold tracking-[-0.63px] text-foreground">
                  Capture
                </h3>
                <p className="font-manrope mt-2 text-sm leading-[22px] text-muted-foreground">
                  Snap a photo or record a walkthrough. It is stamped with time, date, and location automatically.
                </p>
              </div>
            </div>

            {/* Step 2: Organize */}
            <div className="flex flex-col">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[24px] border-[0.8px] border-border bg-card">
                <img
                  src="/organize.png"
                  alt="Photos organized automatically into the right project, sorted and searchable"
                  className="h-full w-full object-cover"
                />
                <div className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary font-manrope text-sm font-bold text-primary-foreground">
                  2
                </div>
              </div>
              <div className="mt-5">
                <h3 className="font-display text-xl font-semibold tracking-[-0.63px] text-foreground">
                  Organize
                </h3>
                <p className="font-manrope mt-2 text-sm leading-[22px] text-muted-foreground">
                  Every photo lands on the right project automatically - sorted, searchable, and mapped.
                </p>
              </div>
            </div>

            {/* Step 3: Report */}
            <div className="flex flex-col">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[24px] border-[0.8px] border-border bg-card">
                <img
                  src="/report.png"
                  alt="AI-generated progress report drafted from your site photos"
                  className="h-full w-full object-cover"
                />
                <div className="absolute top-3 left-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary font-manrope text-sm font-bold text-primary-foreground">
                  3
                </div>
              </div>
              <div className="mt-5">
                <h3 className="font-display text-xl font-semibold tracking-[-0.63px] text-foreground">
                  Report
                </h3>
                <p className="font-manrope mt-2 text-sm leading-[22px] text-muted-foreground">
                  AI drafts your progress report. Review, edit, and share with one tap.
                </p>
              </div>
            </div>
          </div>

          {/* Visual connector */}
          <div className="mt-8 flex items-center justify-center gap-2">
            <div className="h-0.5 w-12 rounded bg-primary/30" />
            <div className="h-0.5 w-12 rounded bg-primary/50" />
            <div className="h-0.5 w-12 rounded bg-primary/70" />
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-primary"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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
              <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
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

