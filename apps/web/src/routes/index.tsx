import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
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
  Clock,
  HardHat,
  Building2,
  UserCheck,
  Briefcase,
  Camera,
  Grid3X3,
  Image as ImageIcon,
  SwitchCamera,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MarketingCta } from "@/components/MarketingCta";
import { MobileAppBanner } from "@/components/MobileAppBanner";
import { DemoAppFrame, type DemoNavId } from "@/demo/DemoAppFrame";
import {
  GalleryScreen,
  MapScreen,
  OverviewScreen,
  ProjectScreen,
  ProjectsScreen,
  ReportsScreen,
} from "@/demo/screens";
import { HIDE_PUBLIC_PRICING, TRIAL_DAYS } from "@/lib/pricing";
import { usePwaGuard } from "@/lib/pwa-guard";
import heroImg from "@/assets/hero-construction.png";
import problemImg from "@/assets/problem-image.png";
import valueImg from "@/assets/value-construction.png";
import collaborationImg from "@/assets/collaboration-image.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Everlumen - The Trusted Job Record for Construction Teams" },
      {
        name: "description",
        content:
          "Every photo becomes a record you can stand behind. Capture, organize, map, and share construction site photos with AI-powered walkthroughs, reports, checklists, and site logs.",
      },
      { property: "og:url", content: "https://www.everlumen.co/" },
      {
        property: "og:title",
        content: "Everlumen - The Trusted Job Record for Construction Teams",
      },
      {
        property: "og:description",
        content:
          "Every photo becomes a record you can stand behind. Capture, organize, map, and share construction site photos with AI-powered walkthroughs, reports, checklists, and site logs.",
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
            "The trusted job record for construction teams. AI-powered photo documentation, walkthroughs, and reports.",
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
    badge: "Ask, investigate, locate",
    title: "AI assistant",
    desc: "Use the assistant for ad hoc project questions: what changed, what is unresolved, and where the evidence is. Reports use the same project record to produce the formal document; workflows remain the structured process for assigned steps and sign-off.",
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
  '"Which phone had that photo?"',
  "Buried in a 400-message group chat",
  "No proof of what happened, when",
  "Reports that take all evening to write",
];

const stats = [
  { value: "4.2M", label: "Photos captured on site" },
  { value: "12k+", label: "Active projects mapped" },
  { value: "9 hrs", label: "Saved per crew, weekly" },
  { value: "4.9\u2605", label: "Average field-team rating" },
];

const testimonials = [
  {
    quote:
      "We settled a change-order dispute in five minutes with a timestamped photo. Everlumen paid for itself on day one.",
    name: "Marcus Reyes",
    role: "Superintendent, Ironline GC",
    project: "Mixed-use development, 14 months",
    company: "Ironline GC",
  },
  {
    quote:
      "Everlumen writes our weekly client reports now. What used to eat my Friday nights takes about thirty seconds.",
    name: "Dana Whitfield",
    role: "Project Manager, Harbor & Stone",
    project: "Custom residential, $4.2M build",
    company: "Harbor & Stone",
  },
  {
    quote:
      "The whole crew finally documents the same way. Nothing gets lost, and clients love the galleries.",
    name: "Theo Andersson",
    role: "Owner, Cedar Ridge Builders",
    project: "Multi-phase commercial, 3 sites",
    company: "Cedar Ridge Builders",
  },
];

const targetAudiences = [
  {
    icon: HardHat,
    title: "Superintendents",
    desc: "Know exactly what happened on site, when, and where. Document progress without slowing down your crew.",
  },
  {
    icon: Briefcase,
    title: "Project Managers",
    desc: "Stop chasing photos and writing reports. Get AI-drafted updates and share them with stakeholders in seconds.",
  },
  {
    icon: Building2,
    title: "Owners & General Contractors",
    desc: "One trusted record across every project. Settle disputes, track progress, and keep clients informed automatically.",
  },
  {
    icon: UserCheck,
    title: "Clients & Stakeholders",
    desc: "See exactly how their investment is progressing with curated galleries and professional reports \u2014 no app required.",
  },
];
/**
 * The interactive product demo, embedded where the mockup drew its
 * "Product screenshot" panel - live, not a static image.
 */
function HeroDemo() {
  const [screen, setScreen] = useState<DemoNavId>("map");
  return (
    <DemoAppFrame active={screen} onSelect={setScreen}>
      {screen === "map" ? (
        <MapScreen onOpenProject={() => {}} />
      ) : screen === "gallery" ? (
        <GalleryScreen />
      ) : screen === "overview" ? (
        <OverviewScreen onOpenProject={() => {}} />
      ) : screen === "projects" ? (
        <ProjectsScreen onOpenProject={() => {}} />
      ) : screen === "reports" ? (
        <ReportsScreen />
      ) : (
        <ProjectsScreen onOpenProject={() => {}} />
      )}
    </DemoAppFrame>
  );
}

function Landing() {
  usePwaGuard();

  return (
    <div className="min-h-screen bg-background landing">
      <MobileAppBanner />
      <SiteHeader transparent />

      {/* Hero - matches the Landing reference: navy gradient, radial gold glow,
          the New pill, 56px Oswald headline, gold pill CTA, and the bordered
          product screenshot panel. */}
      <section className="relative overflow-hidden bg-sidebar">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 30% 20%, rgba(245,180,60,0.16), transparent 55%)",
          }}
        />

        <div className="container relative mx-auto flex max-w-[1160px] flex-col items-center px-4 pb-16 pt-24 text-center sm:pb-20 sm:pt-28 md:pb-24 md:pt-32">
          {/* New pill */}
          <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-4 py-2">
            <span className="font-manrope rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.04em] text-primary-foreground">
              New
            </span>
            <span className="font-manrope text-[12.5px] font-medium text-white/80">
              Live map, walkthroughs &amp; AI-powered reports
            </span>
          </div>

          <h1 className="font-display mt-8 max-w-[820px] text-[40px] font-bold leading-[1.04] tracking-[-0.01em] text-white sm:text-[48px] lg:text-[56px]">
            Every photo becomes a{" "}
            <span className="text-brand-gold">record you can stand behind.</span>
          </h1>

          <p className="font-manrope mt-6 max-w-[600px] text-[15.5px] leading-[1.6] text-white/70 sm:text-[16.5px]">
            Stop losing photos in camera rolls and group chats. Everlumen is the trusted job record
            for construction teams {"\u2014"} capturing, mapping, and organizing every site photo
            automatically, with AI that drafts your reports in seconds.
          </p>

          <div className="mt-9 flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="font-manrope w-full rounded-full bg-primary px-7 py-[15px] text-[15px] font-bold text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
            >
              <Link to="/signup">
                Start free trial <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="font-manrope w-full rounded-full border-2 border-white/40 bg-transparent px-6 py-[15px] text-[15px] font-semibold text-white hover:bg-white/10 sm:w-auto"
            >
              <Link to="/how-it-works">See how it works</Link>
            </Button>
          </div>

          <div className="font-manrope mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-[12.5px] font-medium text-white/60">
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-brand-gold" />
              {HIDE_PUBLIC_PRICING ? `${TRIAL_DAYS}-day free trial` : "Plans from $24/mo"}
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-brand-gold" />
              Set up in minutes
            </div>
            <div className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-brand-gold" />
              No credit card required
            </div>
          </div>

          {/* Product screenshot panel - the live interactive demo */}
          <div className="relative mt-16 w-full overflow-hidden rounded-[20px] border border-white/10 shadow-[0_30px_70px_rgba(0,0,0,0.4)]">
            <HeroDemo />
            <span className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Live demo
            </span>
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
                  className="font-manrope text-sm font-bold tracking-wide text-muted-foreground/60"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* The problem we solve */}
      <section className="bg-background py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col justify-center">
              <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
                The problem
              </p>
              <h2 className="font-display mt-4 text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
                Job site photos shouldn&apos;t be this hard to find.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-[15.5px] leading-[1.6] text-muted-foreground">
                When a question comes up weeks later {"\u2014"} and it always does {"\u2014"} your
                team shouldn&apos;t have to dig through camera rolls, group chats, and email threads
                to find the proof.
              </p>
              <ul className="mt-8 space-y-4">
                {problems.map((p) => (
                  <li key={p} className="flex items-start gap-3">
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                      <span className="h-2 w-2 rounded-full bg-destructive" />
                    </span>
                    <span className="font-manrope text-base text-muted-foreground">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="aspect-[580/520] w-full overflow-hidden rounded-[32px] lg:h-[520px]">
              <img
                src={problemImg}
                alt="Frustrated construction worker looking for photos on a phone"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>
      {/* Pricing anchor - compact preview */}
      <section className="bg-muted py-16 md:py-20">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="rounded-[32px] border-[0.8px] border-border bg-card p-8 md:p-12">
            <div className="flex flex-col items-center text-center">
              <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
                Simple pricing
              </p>
              <h2 className="font-display mt-4 text-3xl font-semibold leading-none tracking-[-0.01em] text-foreground sm:text-4xl">
                Plans from{" "}
                {HIDE_PUBLIC_PRICING ? (
                  <span className="text-primary">contact us</span>
                ) : (
                  <span className="text-primary">$24/mo</span>
                )}
              </h2>
              <p className="font-manrope mt-4 max-w-lg text-base text-muted-foreground">
                One price includes AI reports, walkthroughs, site maps, and unlimited photo storage.
                No per-feature upgrades.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-border bg-background p-6 text-center">
                <p className="font-display text-2xl font-bold text-foreground">Starter</p>
                <p className="font-manrope mt-2 text-sm text-muted-foreground">
                  1 user {"\u00b7"} core capture & maps
                </p>
              </div>
              <div className="rounded-2xl border border-primary bg-primary/5 p-6 text-center">
                <p className="font-display text-2xl font-bold text-foreground">Pro</p>
                <p className="font-manrope mt-2 text-sm text-muted-foreground">
                  5 users {"\u00b7"} AI reports & walkthroughs
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-background p-6 text-center">
                <p className="font-display text-2xl font-bold text-foreground">Team</p>
                <p className="font-manrope mt-2 text-sm text-muted-foreground">
                  Unlimited {"\u00b7"} client sharing & templates
                </p>
              </div>
            </div>
            <div className="mt-8 flex justify-center">
              <Button asChild variant="outline" className="font-manrope rounded-full">
                <Link to="/pricing">
                  Compare all plans <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
      {/* What is New - Everything your field team needs */}
      <section className="border-y border-border bg-muted py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
              Everything your field team needs
            </p>
            <h2 className="font-display mt-4 text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
              One place for the entire job record.
            </h2>
            <p className="font-manrope mx-auto mt-6 max-w-2xl text-[15.5px] leading-[1.6] text-muted-foreground">
              From the first photo to the final report, Everlumen captures, organizes, and shares
              everything {"\u2014"} so your crew can focus on the build.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-2">
            {whatsNew.map((f) => (
              <div key={f.title} className="rounded-[18px] border border-border bg-card p-7">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px]"
                    style={{ backgroundColor: f.iconBg }}
                  >
                    <f.icon className="h-5 w-5 text-white" />
                  </span>
                  {f.badge && (
                    <span
                      className="font-manrope rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider"
                      style={{ backgroundColor: f.ring, color: f.iconBg }}
                    >
                      {f.badge}
                    </span>
                  )}
                </div>
                <h3 className="font-display mt-5 text-[17px] font-bold tracking-[-0.01em] text-foreground">
                  {f.title}
                </h3>
                <p className="font-manrope mt-2 text-[14.5px] leading-[1.55] text-muted-foreground">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex justify-center">
            <Link
              to="/features"
              className="font-manrope text-sm font-semibold text-accent-foreground underline underline-offset-4"
            >
              See every feature in detail <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
      {/* ROI Section */}
      <section className="bg-muted py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col justify-center">
              <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
                The return
              </p>
              <h2 className="font-display mt-4 text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
                9 hours saved, every week, per crew.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-[15.5px] leading-[1.6] text-muted-foreground">
                Stop spending your evenings finding photos, writing reports, and answering project
                questions from memory. Everlumen automates all of it.
              </p>
              <div className="mt-10 space-y-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <Clock className="h-5 w-5 text-destructive" />
                  </span>
                  <div>
                    <h3 className="font-manrope text-[14.5px] font-bold text-foreground">
                      Without Everlumen
                    </h3>
                    <p className="font-manrope mt-1 text-[13.5px] leading-[1.5] text-muted-foreground">
                      Hunting through camera rolls, group chats, and email threads. Writing reports
                      by hand. Searching for proof of what happened.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Check className="h-5 w-5 text-primary" />
                  </span>
                  <div>
                    <h3 className="font-manrope text-[14.5px] font-bold text-foreground">
                      With Everlumen
                    </h3>
                    <p className="font-manrope mt-1 text-[13.5px] leading-[1.5] text-muted-foreground">
                      Photos auto-organized, mapped, and searchable. AI drafts your reports in
                      seconds. One link shares the full job record.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <div className="rounded-[18px] border border-border bg-card p-[32px]">
                <p className="font-manrope text-[11.5px] font-bold uppercase tracking-[0.08em] text-faint">
                  Time saved per week
                </p>
                <p className="font-display mt-3 text-[44px] font-bold leading-none tracking-[-0.01em] text-accent-foreground">
                  9 hrs
                </p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">
                      Finding photos
                    </span>
                    <span className="font-manrope text-sm font-bold text-foreground">3.2 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[88%] rounded-full bg-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">
                      Writing reports
                    </span>
                    <span className="font-manrope text-sm font-bold text-foreground">2.8 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[76%] rounded-full bg-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">
                      Answering questions
                    </span>
                    <span className="font-manrope text-sm font-bold text-foreground">2.1 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[58%] rounded-full bg-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">
                      Managing files
                    </span>
                    <span className="font-manrope text-sm font-bold text-foreground">0.9 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[24%] rounded-full bg-primary" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* How It Works - the mockup navy band with three steps */}
      <section className="bg-sidebar py-24">
        <div className="mx-auto max-w-[1160px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-brand-gold">
              How it works
            </p>
            <h2 className="font-display mx-auto mt-5 max-w-2xl text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-white">
              Capture. Organize. Report.
            </h2>
            <p className="font-manrope mx-auto mt-5 text-[15.5px] leading-[1.6] text-white/60">
              Three steps to a complete job site record. No learning curve, no extra work.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3 lg:gap-x-8">
            {/* Step 1: Capture */}
            <div className="flex flex-col">
              <div className="relative h-[200px] w-full overflow-hidden rounded-[16px] bg-gradient-to-br from-[#2b3350] to-[#171b2c]">
                <img
                  src="/capture-image.png"
                  alt="Everlumen camera view for capturing a job site photo"
                  className="h-full w-full object-cover opacity-80"
                />
                <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-3 pb-8 text-white">
                  <span className="rounded-full bg-black/45 p-2 backdrop-blur">
                    <Camera className="h-4 w-4" />
                  </span>
                  <span className="flex gap-1.5">
                    <span className="rounded-full bg-black/45 p-2 backdrop-blur">
                      <Grid3X3 className="h-4 w-4" />
                    </span>
                    <span className="rounded-full bg-black/45 p-2 backdrop-blur">
                      <Zap className="h-4 w-4" />
                    </span>
                    <span className="rounded-full bg-black/45 p-2 backdrop-blur">
                      <SwitchCamera className="h-4 w-4" />
                    </span>
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-3 pb-3 pt-12 text-white">
                  <div className="mx-auto mb-2 flex w-fit max-w-full items-center gap-1 overflow-hidden rounded-xl bg-black/55 p-1 text-[8px] font-bold uppercase tracking-wide ring-1 ring-white/15 backdrop-blur">
                    <span className="rounded-lg bg-white px-2 py-1 text-black">Picture</span>
                    <span className="px-1.5 py-1 text-white/75">Before/After</span>
                    <span className="px-1.5 py-1 text-white/75">Scan</span>
                    <span className="px-1.5 py-1 text-white/75">Video</span>
                  </div>
                  <div className="flex items-center justify-around">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                      <ImageIcon className="h-4 w-4" />
                    </span>
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-white bg-white/10 ring-2 ring-black/30">
                      <span className="h-9 w-9 rounded-full bg-white" />
                    </span>
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-[8px] font-bold ring-1 ring-white/15">
                      LVL
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-manrope text-xs font-bold text-primary-foreground">
                  1
                </span>
                <h3 className="font-display text-[16px] font-bold text-white">Capture</h3>
              </div>
              <p className="font-manrope mt-2.5 text-[13.5px] leading-[1.55] text-white/60">
                Use the field camera with grid, flash, camera switching, gallery import, level
                guidance, and capture modes for picture, before/after, scan, video, and
                walkthroughs. Photos are stamped with time, date, and location automatically.
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
              <div className="mt-4 flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-manrope text-xs font-bold text-primary-foreground">
                  2
                </span>
                <h3 className="font-display text-[16px] font-bold text-white">Organize</h3>
              </div>
              <p className="font-manrope mt-2.5 text-[13.5px] leading-[1.55] text-white/60">
                Every photo lands on the right project automatically - sorted, searchable, and
                mapped.
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
              <div className="mt-4 flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary font-manrope text-xs font-bold text-primary-foreground">
                  3
                </span>
                <h3 className="font-display text-[16px] font-bold text-white">Report</h3>
              </div>
              <p className="font-manrope mt-2.5 text-[13.5px] leading-[1.55] text-white/60">
                AI drafts your progress report. Review, edit, and share with one tap.
              </p>
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <Button
              asChild
              className="font-manrope rounded-full border-2 border-white/40 bg-transparent px-7 py-[13px] text-[14.5px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <Link to="/how-it-works">
                See the full walkthrough <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
      {/* Who It is For */}
      <section className="bg-background py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
              Who it&apos;s for
            </p>
            <h2 className="font-display mt-4 text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
              Built for every role on the job.
            </h2>
            <p className="font-manrope mx-auto mt-6 max-w-2xl text-[15.5px] leading-[1.6] text-muted-foreground">
              From the superintendent in the field to the owner in the office, Everlumen gives every
              stakeholder the visibility they need.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {targetAudiences.map((a) => (
              <div key={a.title} className="rounded-[18px] border border-border bg-card p-[22px]">
                <h3 className="font-manrope text-[15px] font-bold text-foreground">{a.title}</h3>
                <p className="font-manrope mt-2 text-[13.5px] leading-[1.5] text-muted-foreground">
                  {a.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value */}
      <section className="bg-background py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="aspect-[580/520] w-full overflow-hidden rounded-[32px] lg:h-[520px]">
              <img
                src={valueImg}
                alt="Everlumen interface showing organized project photos and site map"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col justify-center">
              <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
                The value
              </p>
              <h2 className="font-display mt-4 text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
                Every photo tells the story of your build.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-[15.5px] leading-[1.6] text-muted-foreground">
                Timestamped. GPS-tagged. AI-organized. Everlumen turns every photo into a verifiable
                record {"\u2014"} so you can settle disputes in minutes, not days.
              </p>
              <Button asChild className="font-manrope mt-8 w-fit rounded-full">
                <Link to="/signup">
                  Start your free trial <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
      {/* Collaboration */}
      <section className="bg-muted py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="aspect-[580/520] w-full overflow-hidden rounded-[32px] lg:h-[520px]">
              <img
                src={collaborationImg}
                alt="Two construction professionals collaborating over a tablet on site"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
                Collaboration
              </p>
              <h2 className="font-display mt-4 text-[32px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
                The whole crew, finally in sync.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-[15.5px] leading-[1.6] text-muted-foreground">
                From the superintendent to the office to the client, everyone works from the same
                up-to-date project - no forwarding, no group chats, no guessing what happened on
                site.
              </p>
              <ul className="mt-10 space-y-6">
                {collaborationPoints.map((p) => (
                  <li key={p.title} className="flex flex-col gap-1">
                    <h3 className="font-manrope text-[14.5px] font-bold text-foreground">
                      {p.title}
                    </h3>
                    <p className="font-manrope text-[13.5px] leading-[1.5] text-muted-foreground">
                      {p.desc}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Proof, not promises - strengthened testimonials */}
      <section className="border-y border-border bg-muted py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-xs font-bold uppercase tracking-[0.14em] text-accent-foreground">
              Why teams trust Everlumen
            </p>
            <h2 className="font-display mt-4 text-[36px] font-bold leading-[1.04] tracking-[-0.01em] text-foreground">
              Proof, not promises.
            </h2>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-[18px] border border-border bg-card p-[22px] text-center"
              >
                <p className="font-display text-[34px] font-bold leading-none tracking-[-0.01em] text-foreground">
                  {s.value}
                </p>
                <p className="font-manrope mt-1.5 text-[13px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {testimonials.map((t) => (
              <figure
                key={t.name}
                className="flex flex-col rounded-[18px] border border-border bg-card p-6"
              >
                <div className="flex gap-1" aria-label="5 out of 5 stars">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
                <blockquote className="font-manrope mt-3.5 flex-1 text-[14px] leading-[1.55] text-muted-foreground">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-4">
                  <p className="font-manrope text-[13px] font-bold text-foreground">{t.name}</p>
                  <p className="font-manrope text-[12px] text-faint">{t.role}</p>
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
