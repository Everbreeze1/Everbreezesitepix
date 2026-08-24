import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Users,
  ShieldCheck,
  Bell,
  Star,
  Check,
  ArrowRight,
  ArrowUpRight,
  Map as MapIcon,
  Video,
  Sparkles,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MarketingCta } from "@/components/MarketingCta";
import { MobileAppBanner } from "@/components/MobileAppBanner";
import heroImg from "@/assets/hero-construction.png";
import problemImg from "@/assets/problem-image.png";
import valueImg from "@/assets/value-construction.png";
import collaborationImg from "@/assets/collaboration-image.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Everlumen - Capture & Share Job Site Photos" },
      {
        name: "description",
        content:
          "Capture, organize, map, and share construction site photos with AI-powered walkthroughs, reports, checklists, and site logs.",
      },
      { property: "og:url", content: "https://www.everlumen.co/" },
      { property: "og:title", content: "Everlumen - Capture & Share Job Site Photos" },
      {
        property: "og:description",
        content:
          "Capture, organize, map, and share construction site photos with AI-powered walkthroughs, reports, checklists, and site logs.",
      },
    ],
    links: [{ rel: "canonical", href: "https://www.everlumen.co/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Everlumen",
          url: "https://www.everlumen.co/",
          logo: "https://www.everlumen.co/icon-512.png",
          description:
            "Construction job site photo management with AI-powered analysis for contractors and field teams.",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Everlumen",
          url: "https://www.everlumen.co/",
        }),
      },
    ],
  }),
  component: Landing,
});

const howItWorks = [
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

const whatsNew = [
  {
    icon: MapIcon,
    iconBg: "#34D399",
    ring: "#A7F3D0",
    badge: "Live project context",
    title: "Live site map",
    desc: "Every project pinned on one interactive map. See every active job, jump to the latest photos, and know exactly where your crews are.",
    span: "wide",
  },
  {
    icon: Video,
    iconBg: "#38BDF8",
    ring: "#BAE6FD",
    badge: undefined as string | undefined,
    title: "Recorded walkthroughs",
    desc: "Record narrated video walkthroughs with audio, tied to the project timeline so anyone can revisit the site without leaving the office.",
    span: "narrow",
  },
  {
    icon: Sparkles,
    iconBg: "#A78BFA",
    ring: "#DDD6FE",
    badge: undefined as string | undefined,
    title: "AI assistant",
    desc: "Ask AI anything about a project. It answers questions from your photos and drafts professional reports in seconds.",
    span: "narrow",
  },
  {
    icon: Layers,
    iconBg: "#FCD34D",
    ring: "#FDE68A",
    badge: undefined as string | undefined,
    title: "Smart organization",
    desc: "Timestamped, GPS-tagged and auto-sorted by project. No more scrolling camera rolls or digging through group chats.",
    span: "wide",
  },
] as const;

const trustedCompanies = [
  "Meridian Build",
  "Ironline GC",
  "Harbor & Stone",
  "Northgate Const.",
  "Vantage Group",
  "Cedar Ridge",
];

const problems = [
  "“Which phone had that photo?”",
  "Buried in a 400-message group chat",
  "No proof of what happened, when",
  "Reports that take all evening to write",
];

const stats = [
  { value: "4.2M", label: "Photos captured on site" },
  { value: "12k+", label: "Active projects mapped" },
  { value: "9 hrs", label: "Saved per crew, weekly" },
  { value: "4.9★", label: "Average field-team rating" },
];

const testimonials = [
  {
    quote:
      "We settled a change-order dispute in five minutes with a timestamped photo. Everlumen paid for itself on day one.",
    name: "Marcus Reyes",
    role: "Superintendent, Ironline GC",
  },
  {
    quote:
      "Everlumen writes our weekly client reports now. What used to eat my Friday nights takes about thirty seconds.",
    name: "Dana Whitfield",
    role: "Project Manager, Harbor & Stone",
  },
  {
    quote:
      "The whole crew finally documents the same way. Nothing gets lost, and clients love the galleries.",
    name: "Theo Andersson",
    role: "Owner, Cedar Ridge Builders",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <MobileAppBanner />
      <SiteHeader transparent />

      {/* Hero */}
      <section className="relative -mt-[70px] overflow-hidden bg-sidebar">
        <img
          src={heroImg}
          alt="Construction professional capturing a job site photo"
          className="absolute inset-0 h-full w-full object-cover opacity-45"
        />
        <div className="container relative mx-auto flex max-w-[875px] flex-col items-center px-4 pb-24 pt-[166px] text-center sm:pb-28 sm:pt-[182px] md:pb-36 md:pt-[214px]">
          <div className="inline-flex items-center gap-2 rounded-full bg-sidebar-foreground px-3 py-1.5 shadow-sm">
            <span className="font-manrope rounded-full bg-sidebar-ring px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sidebar-foreground">
              New
            </span>
            <span className="font-manrope text-xs font-extrabold text-sidebar">
              Live map, walkthroughs & AI-powered reports
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-sidebar" />
          </div>

          <h1 className="font-display mt-8 max-w-4xl text-4xl font-black uppercase leading-[0.95] tracking-[-0.03em] text-sidebar-foreground sm:text-6xl md:text-7xl lg:text-[96px]">
            Capture, organize &amp; share <span className="text-sidebar-ring">job site photos</span>{" "}
            - powered by AI.
          </h1>

          <p className="font-manrope mt-7 max-w-2xl text-base text-sidebar-foreground/80 md:text-lg">
            Stop losing photos in camera rolls and group chats. Everlumen documents every project,
            maps every site, records walkthroughs, and auto-drafts reports and site logs from your
            photos.
          </p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="font-manrope w-full rounded-lg bg-sidebar-foreground px-6 py-3.5 text-sm font-bold text-sidebar shadow-elegant hover:bg-sidebar-foreground/90 sm:w-auto"
            >
              <Link to="/signup">
                Get started <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="font-manrope w-full rounded-lg border-sidebar-border bg-transparent px-6 py-3.5 text-sm font-bold text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground sm:w-auto"
            >
              <Link to="/pricing">See pricing</Link>
            </Button>
          </div>

          <div className="font-manrope mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold text-sidebar-foreground/80">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-sidebar-ring" />
              Plans from $24/mo
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-sidebar-ring" />
              Set up in minutes
            </div>
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-sidebar-ring" />
              Cancel anytime
            </div>
          </div>
        </div>
      </section>

      {/* Trusted by */}
      <section className="border-y border-border bg-muted py-8">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <p className="font-manrope text-center text-xs font-semibold uppercase tracking-[2.64px] text-muted-foreground">
            Trusted by field teams building across the country
          </p>
          <div className="relative mt-6 overflow-hidden">
            <div className="flex w-max items-center gap-14 animate-marquee hover:[animation-play-state:paused]">
              {[...trustedCompanies, ...trustedCompanies].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="font-display shrink-0 text-xl font-semibold tracking-[-0.7px] text-foreground/45"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The problem */}
      <section className="bg-muted py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                The problem
              </p>
              <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
                The field moves fast. The paperwork never keeps up.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-lg leading-[29px] text-muted-foreground">
                Crews take thousands of photos a month - scattered across phones, texts and inboxes.
                When you need proof, a progress update, or a client-ready gallery, it is nowhere to
                be found.
              </p>
              <ul className="mt-8">
                {problems.map((text) => (
                  <li key={text} className="flex items-center gap-3 border-b border-border py-3">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="font-manrope text-base text-muted-foreground">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="aspect-[580/540] w-full overflow-hidden rounded-[32px] bg-muted">
              <img
                src={problemImg}
                alt="Worker in gloves browsing job site photos on a phone at a construction site"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* What's new */}
      <section className="relative overflow-hidden bg-sidebar py-20 md:py-32">
        <div className="pointer-events-none absolute -top-10 right-0 h-72 w-72 rounded-full bg-sidebar-ring/10 blur-[64px]" />
        <div className="relative mx-auto max-w-[1280px] px-4">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-manrope text-xs font-extrabold uppercase tracking-[2.16px] text-sidebar-ring">
                What's new
              </p>
              <h2 className="font-display mt-4 max-w-xl text-4xl font-bold leading-[0.95] tracking-[-2.1px] text-sidebar-foreground sm:text-5xl md:text-6xl">
                Tools that make the job record{" "}
                <span className="text-sidebar-ring">move with you.</span>
              </h2>
            </div>
            <p className="font-manrope max-w-md text-base leading-7 text-sidebar-foreground">
              A better way to see where work is happening, capture context in the moment, and hand
              off a record everyone can trust.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-12">
            {whatsNew.map((item) => (
              <div
                key={item.title}
                className={`flex flex-col rounded-3xl border border-sidebar-border bg-sidebar-foreground/[0.043] p-7 ${item.span === "wide" ? "lg:col-span-7" : "lg:col-span-5"}`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="relative flex h-12 w-12 items-center justify-center rounded-[17.6px]"
                    style={{
                      background: item.iconBg,
                      boxShadow: `0 0 0 4px #101929, 0 0 0 8px ${item.ring}`,
                    }}
                  >
                    <item.icon className="h-5 w-5 text-[#101929]" />
                    <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-[1.6px] border-sidebar bg-sidebar-foreground" />
                  </div>
                  {item.badge && (
                    <div className="flex items-center gap-1.5 rounded-full border border-sidebar-border bg-sidebar-foreground/5 px-3 py-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34D399]" />
                      <span className="font-manrope text-[10px] font-extrabold uppercase tracking-[1.3px] text-sidebar-foreground/70">
                        {item.badge}
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-10 flex-1">
                  <h3 className="font-display text-3xl font-semibold tracking-[-1.05px] text-sidebar-foreground">
                    {item.title}
                  </h3>
                  <p className="font-manrope mt-3 max-w-lg text-sm leading-6 text-sidebar-foreground/60">
                    {item.desc}
                  </p>
                </div>
                <Link
                  to="/features"
                  className="font-manrope mt-5 inline-flex items-center gap-1 text-xs font-extrabold text-sidebar-ring"
                >
                  Explore feature <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Organized photos, real value */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4">
          <div className="flex w-full flex-col items-center">
            <div className="flex w-full max-w-[768px] flex-col items-center">
              <p className="font-manrope text-center text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                Organized photos, real value
              </p>
              <h2 className="font-display mt-4 text-center text-4xl font-semibold leading-none tracking-[-1.4px] text-foreground sm:text-5xl sm:tracking-[-1.8px] lg:text-[60px] lg:tracking-[-2.1px]">
                Every photo becomes a record you can{" "}
                <span className="text-primary">stand behind.</span>
              </h2>
            </div>
          </div>

          <div className="mt-10 flex w-full flex-col gap-6 md:mt-16 lg:flex-row">
            <div className="aspect-[699/440] w-full overflow-hidden rounded-[32px] lg:aspect-auto lg:h-[440px] lg:min-w-0 lg:flex-[1.42]">
              <img
                src={valueImg}
                alt="A modern building mid-construction documented over time"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex min-h-[440px] w-full flex-col justify-between gap-6 rounded-[32px] bg-sidebar p-8 sm:p-12 lg:w-auto lg:min-w-0 lg:max-w-[493px] lg:flex-1">
              <div>
                <h3 className="font-display text-[30px] font-semibold leading-9 tracking-[-1.05px] text-sidebar-foreground">
                  Before &amp; after, on the record.
                </h3>
                <p className="font-manrope mt-4 text-base leading-[26px] text-sidebar-foreground/60">
                  Progress documentation that protects your team - timestamped, GPS-tagged and
                  impossible to dispute. Settle change orders and inspections with the photo, not
                  the argument.
                </p>
              </div>
              <div className="border-t border-sidebar-border pt-8">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="font-display text-[30px] font-bold leading-9 tracking-[-1.05px] text-sidebar-ring">
                      100%
                    </p>
                    <p className="font-manrope mt-1 text-sm leading-5 text-sidebar-foreground/55">
                      Timestamped &amp; GPS-tagged
                    </p>
                  </div>
                  <div>
                    <p className="font-display text-[30px] font-bold leading-9 tracking-[-1.05px] text-sidebar-ring">
                      0
                    </p>
                    <p className="font-manrope mt-1 text-sm leading-5 text-sidebar-foreground/55">
                      Photos lost to camera rolls
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-muted py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4">
          <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
            How it works
          </p>
          <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
            Three steps. Zero busywork.
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {howItWorks.map((s) => (
              <div key={s.step} className="rounded-[32px] border border-border bg-card p-8">
                <span className="font-display text-4xl font-bold text-primary/25">{s.step}</span>
                <h3 className="font-manrope mt-4 text-lg font-semibold text-foreground">
                  {s.title}
                </h3>
                <p className="font-manrope mt-3 text-[15px] leading-6 text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Collaboration */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4">
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

      {/* Proof, not promises */}
      <section className="bg-muted py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4">
          <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
            Why teams trust Everlumen
          </p>
          <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
            Proof, not promises.
          </h2>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-3xl border-[0.8px] border-border bg-card/50 p-7"
              >
                <p className="font-display text-5xl font-bold leading-none tracking-[-1.68px] text-foreground">
                  {s.value}
                </p>
                <p className="font-manrope mt-2 text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure
                key={t.name}
                className="rounded-3xl border-[0.8px] border-border bg-card/50 p-8"
              >
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
                <blockquote className="font-display mt-5 text-lg leading-[29px] tracking-[-0.63px] text-muted-foreground">
                  "{t.quote}"
                </blockquote>
                <figcaption className="mt-6 border-t border-border pt-5">
                  <p className="font-manrope text-base font-semibold text-foreground">{t.name}</p>
                  <p className="font-manrope text-sm text-muted-foreground">{t.role}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <MarketingCta />

      <SiteFooter />
    </div>
  );
}
