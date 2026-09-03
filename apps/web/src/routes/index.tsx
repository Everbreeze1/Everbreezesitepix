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
  Clock,
  HardHat,
  Building2,
  UserCheck,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MarketingCta } from "@/components/MarketingCta";
import { MobileAppBanner } from "@/components/MobileAppBanner";
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
      { property: "og:title", content: "Everlumen - The Trusted Job Record for Construction Teams" },
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
  "\"Which phone had that photo?\"",
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
function Landing() {
  usePwaGuard();

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
            Every photo becomes a{" "}
            <span className="text-sidebar-ring">record you can stand behind.</span>
          </h1>

          <p className="font-manrope mt-7 max-w-2xl text-base text-sidebar-foreground/80 md:text-lg">
            Stop losing photos in camera rolls and group chats. Everlumen is the trusted job record
            for construction teams {"\u2014"} capturing, mapping, and organizing every site photo
            automatically, with AI that drafts your reports in seconds.
          </p>

          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="font-manrope w-full rounded-lg bg-sidebar-foreground px-6 py-3.5 text-sm font-bold text-sidebar shadow-elegant hover:bg-sidebar-foreground/90 sm:w-auto"
            >
              <Link to="/signup">
                Start documenting your jobs <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="font-manrope w-full rounded-lg border-sidebar-border bg-transparent px-6 py-3.5 text-sm font-bold text-sidebar-foreground hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground sm:w-auto"
            >
              <Link to="/how-it-works">See how it works</Link>
            </Button>
          </div>

          <div className="font-manrope mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold text-sidebar-foreground/80">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-sidebar-ring" />
              {HIDE_PUBLIC_PRICING ? `${TRIAL_DAYS}-day free trial` : "Plans from $24/mo"}
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
              <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                The problem
              </p>
              <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
                Job site photos shouldn&apos;t be this hard to find.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-lg leading-[29px] text-muted-foreground">
                When a question comes up weeks later {"\u2014"} and it always does {"\u2014"} your team shouldn&apos;t
                have to dig through camera rolls, group chats, and email threads to find the proof.
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
              <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                Simple pricing
              </p>
              <h2 className="font-display mt-4 text-3xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-4xl">
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
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
              Everything your field team needs
            </p>
            <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
              One place for the entire job record.
            </h2>
            <p className="font-manrope mx-auto mt-6 max-w-2xl text-lg leading-[29px] text-muted-foreground">
              From the first photo to the final report, Everlumen captures, organizes, and shares
              everything {"\u2014"} so your crew can focus on the build.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {whatsNew.map((f) => (
              <div
                key={f.title}
                className={`rounded-[28px] border-[0.8px] border-border bg-card/50 p-7 ${
                  f.span === "wide" && f === whatsNew[0] ? "lg:col-span-2" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-xl"
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
                <h3 className="font-display mt-5 text-xl font-semibold tracking-[-0.63px] text-foreground">
                  {f.title}
                </h3>
                <p className="font-manrope mt-2 text-sm leading-[22px] text-muted-foreground">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* ROI Section */}
      <section className="bg-muted py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col justify-center">
              <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                The return
              </p>
              <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
                9 hours saved, every week, per crew.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-lg leading-[29px] text-muted-foreground">
                Stop spending your evenings finding photos, writing reports, and answering
                project questions from memory. Everlumen automates all of it.
              </p>
              <div className="mt-10 space-y-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10">
                    <Clock className="h-5 w-5 text-destructive" />
                  </span>
                  <div>
                    <h3 className="font-manrope text-base font-semibold text-foreground">
                      Without Everlumen
                    </h3>
                    <p className="font-manrope mt-1 text-sm text-muted-foreground">
                      Hunting through camera rolls, group chats, and email threads. Writing reports
                      by hand. Searching for proof of what happened.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Check className="h-5 w-5 text-primary" />
                  </span>
                  <div>
                    <h3 className="font-manrope text-base font-semibold text-foreground">
                      With Everlumen
                    </h3>
                    <p className="font-manrope mt-1 text-sm text-muted-foreground">
                      Photos auto-organized, mapped, and searchable. AI drafts your reports in
                      seconds. One link shares the full job record.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <div className="rounded-[32px] border-[0.8px] border-border bg-card p-8 md:p-10">
                <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-muted-foreground">
                  Time saved per week
                </p>
                <p className="font-display mt-3 text-6xl font-bold leading-none tracking-[-2.1px] text-primary">
                  9 hrs
                </p>
                <div className="mt-8 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">Finding photos</span>
                    <span className="font-manrope text-sm font-bold text-foreground">3.2 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[80%] rounded-full bg-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">Writing reports</span>
                    <span className="font-manrope text-sm font-bold text-foreground">2.8 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[70%] rounded-full bg-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">Answering questions</span>
                    <span className="font-manrope text-sm font-bold text-foreground">2.1 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[55%] rounded-full bg-primary" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-manrope text-sm text-muted-foreground">Managing files</span>
                    <span className="font-manrope text-sm font-bold text-foreground">0.9 hrs</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 w-[25%] rounded-full bg-primary" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* How It Works - visual journey with product screenshots */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
              How it works
            </p>
            <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
              Capture. Organize. Report.
            </h2>
            <p className="font-manrope mx-auto mt-6 max-w-2xl text-lg leading-[29px] text-muted-foreground">
              Three steps to a complete job site record. No learning curve, no extra work.
            </p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
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
            <ArrowRight className="h-4 w-4 text-primary" />
          </div>

          <div className="mt-8 flex justify-center">
            <Button asChild variant="outline" className="font-manrope rounded-full">
              <Link to="/how-it-works">
                See the full walkthrough <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
      {/* Who It is For */}
      <section className="bg-muted py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
              Who it&apos;s for
            </p>
            <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
              Built for every role on the job.
            </h2>
            <p className="font-manrope mx-auto mt-6 max-w-2xl text-lg leading-[29px] text-muted-foreground">
              From the superintendent in the field to the owner in the office, Everlumen gives every
              stakeholder the visibility they need.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {targetAudiences.map((a) => (
              <div
                key={a.title}
                className="rounded-[28px] border-[0.8px] border-border bg-card p-7"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                  <a.icon className="h-6 w-6 text-primary" />
                </span>
                <h3 className="font-display mt-5 text-xl font-semibold tracking-[-0.63px] text-foreground">
                  {a.title}
                </h3>
                <p className="font-manrope mt-2 text-sm leading-[22px] text-muted-foreground">
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
              <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
                The value
              </p>
              <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
                Every photo tells the story of your build.
              </h2>
              <p className="font-manrope mt-6 max-w-lg text-lg leading-[29px] text-muted-foreground">
                Timestamped. GPS-tagged. AI-organized. Everlumen turns every photo into a
                verifiable record {"\u2014"} so you can settle disputes in minutes, not days.
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

      {/* Proof, not promises - strengthened testimonials */}
      <section className="bg-background py-20 md:py-32">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
          <div className="text-center">
            <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
              Why teams trust Everlumen
            </p>
            <h2 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
              Proof, not promises.
            </h2>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-[28px] border-[0.8px] border-border bg-card/50 p-7"
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
                className="flex flex-col rounded-[28px] border-[0.8px] border-border bg-card/50 p-8"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <span className="font-manrope text-sm font-bold text-primary">
                      {t.name.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="font-manrope text-sm font-semibold text-foreground">{t.name}</p>
                    <p className="font-manrope text-xs text-muted-foreground">{t.role}</p>
                  </div>
                </div>
                <div className="mt-4 flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                  ))}
                </div>
                <blockquote className="font-manrope mt-4 flex-1 text-base leading-[26px] text-muted-foreground">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-5 border-t border-border pt-4">
                  <p className="font-manrope text-xs font-semibold text-foreground">
                    {t.company}
                  </p>
                  <p className="font-manrope text-xs text-muted-foreground">{t.project}</p>
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

