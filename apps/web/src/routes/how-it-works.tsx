import { createFileRoute } from "@tanstack/react-router";
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
      { title: "How It Works — Everbreeze SitePix" },
      {
        name: "description",
        content:
          "SitePix fits the way crews already work. Snap a photo on site, let it organize itself, then share a clean gallery or report — no new process to learn.",
      },
      { property: "og:title", content: "How It Works — Everbreeze SitePix" },
      {
        property: "og:description",
        content:
          "SitePix fits the way crews already work. Snap a photo on site, let it organize itself, then share a clean gallery or report — no new process to learn.",
      },
      { property: "og:url", content: "https://www.everbreezesitepix.com/how-it-works" },
    ],
    links: [{ rel: "canonical", href: "https://www.everbreezesitepix.com/how-it-works" }],
  }),
});

const steps = [
  {
    step: "01",
    title: "Snap it on site",
    desc: "Open SitePix, take the photo or record a walkthrough. It is stamped with time, date and location the moment you capture it.",
  },
  {
    step: "02",
    title: "It organizes itself",
    desc: "Every photo lands on the right project automatically — sorted, searchable and mapped without a single tap of admin work.",
  },
  {
    step: "03",
    title: "Share & report",
    desc: "Send a clean gallery to a client, or let Breeze AI draft the progress report. Everyone stays aligned, no group chats required.",
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
    desc: "Give clients a curated gallery, subs their scope, and admins the full picture — with permissions you control.",
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
            Snap it. Sort it. <span className="text-primary">Send it.</span>
          </h1>
          <p className="font-manrope mx-auto mt-6 max-w-xl text-lg leading-[29px] text-muted-foreground">
            SitePix fits the way crews already work. No new process to learn — just open the app and
            capture.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="py-24">
        <div className="mx-auto max-w-[1280px] px-8">
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.step}
                className="rounded-[32px] border-[0.8px] border-border bg-card/50 p-10"
              >
                <span className="font-display text-6xl font-bold leading-none tracking-[-2.1px] text-primary/20">
                  {s.step}
                </span>
                <h3 className="font-display mt-5 text-2xl font-semibold leading-8 tracking-[-0.84px] text-foreground">
                  {s.title}
                </h3>
                <p className="font-manrope mt-3 text-base leading-[26px] text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            ))}
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
                up-to-date project — no forwarding, no group chats, no guessing what happened on
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
