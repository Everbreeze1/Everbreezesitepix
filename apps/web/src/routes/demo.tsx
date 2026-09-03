import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  FileText,
  FolderKanban,
  Images,
  LayoutDashboard,
  Map as MapIcon,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { MarketingCta } from "@/components/MarketingCta";
import { DemoAppFrame, type DemoNavId } from "@/demo/DemoAppFrame";
import {
  GalleryScreen,
  MapScreen,
  OverviewScreen,
  ProjectScreen,
  ProjectsScreen,
  ReportsScreen,
} from "@/demo/screens";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Interactive demo - Everlumen" },
      {
        name: "description",
        content:
          "Walk the Everlumen UI without an account. Tour the project dashboard, photo gallery, site map and AI reports with sample data.",
      },
      { property: "og:title", content: "Interactive demo - Everlumen" },
      {
        property: "og:description",
        content:
          "Walk the Everlumen UI without an account. Tour the project dashboard, photo gallery, site map and AI reports with sample data.",
      },
      { property: "og:url", content: "https://www.everlumen.co/demo" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://www.everlumen.co/demo" }],
  }),
  component: DemoPage,
});

const screenOptions: Array<{
  id: DemoNavId;
  label: string;
  icon: typeof LayoutDashboard;
  blurb: string;
}> = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    blurb: "What is moving across your jobs, at a glance.",
  },
  {
    id: "projects",
    label: "Projects",
    icon: FolderKanban,
    blurb: "Every job in one list — status, photos, latest update.",
  },
  {
    id: "project",
    label: "Project & photos",
    icon: Camera,
    blurb: "A project's photo log, organised and searchable.",
  },
  {
    id: "map",
    label: "Maps",
    icon: MapIcon,
    blurb: "All active sites pinned on one map.",
  },
  {
    id: "gallery",
    label: "Gallery",
    icon: Images,
    blurb: "Every photo from every job, filtered by project.",
  },
  {
    id: "reports",
    label: "Reports",
    icon: FileText,
    blurb: "AI-drafted progress reports and daily logs.",
  },
];

const featureTiles = [
  {
    title: "Photos that prove themselves",
    body: "Every shot is timestamped and mapped to its job — no more scrolling camera rolls or digging through group chats.",
  },
  {
    title: "AI that writes the report",
    body: "Draft progress reports, daily logs and inspections from the photos your crew already took. Ready to send in seconds.",
  },
  {
    title: "One view of every site",
    body: "Projects, maps and galleries live in one place, so the office and the field are always looking at the same record.",
  },
];

function DemoPage() {
  const [active, setActive] = useState<DemoNavId>("overview");
  const [projectId, setProjectId] = useState("maple");

  const openProject = (id: string) => {
    setProjectId(id);
    setActive("project");
  };

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <DemoHero />
      <DemoPicker active={active} onSelect={setActive} />
      <DemoFrame
        active={active}
        projectId={projectId}
        openProject={openProject}
        setActive={setActive}
      />
      <DemoFeatures />
      <MarketingCta />
      <SiteFooter />
    </div>
  );
}

function DemoHero() {
  return (
    <section className="bg-background py-16 md:py-20">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="max-w-2xl">
          <p className="font-manrope text-sm font-semibold uppercase tracking-[2.8px] text-primary">
            Interactive demo
          </p>
          <h1 className="font-display mt-4 text-4xl font-semibold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
            See the UI. No account, no sign-up.
          </h1>
          <p className="font-manrope mt-5 max-w-xl text-lg leading-[29px] text-muted-foreground">
            Walk the Everlumen workspace yourself — the dashboard, project photo logs, site map,
            gallery and AI reports — built with sample data that mirrors how crews use it on the
            job.
          </p>
          <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-xs font-bold text-muted-foreground">
            <Monitor className="h-4 w-4 text-primary" />
            Everything on this page is a simulation — your data never leaves your browser.
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoPicker({
  active,
  onSelect,
}: {
  active: DemoNavId;
  onSelect: (id: DemoNavId) => void;
}) {
  return (
    <section className="pb-4">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="flex flex-wrap gap-2">
          {screenOptions.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelect(s.id)}
                aria-pressed={isActive}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-4 py-2 font-manrope text-sm font-bold transition",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DemoFrame({
  active,
  projectId,
  openProject,
  setActive,
}: {
  active: DemoNavId;
  projectId: string;
  openProject: (id: string) => void;
  setActive: (id: DemoNavId) => void;
}) {
  return (
    <section className="pb-8">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <DemoAppFrame active={active} onSelect={setActive}>
          {active === "overview" && <OverviewScreen onOpenProject={openProject} />}
          {active === "projects" && <ProjectsScreen onOpenProject={openProject} />}
          {active === "project" && (
            <ProjectScreen projectId={projectId} onBack={() => setActive("projects")} />
          )}
          {active === "map" && <MapScreen onOpenProject={openProject} />}
          {active === "gallery" && <GalleryScreen />}
          {active === "reports" && <ReportsScreen />}
        </DemoAppFrame>

        <p className="font-manrope mt-4 text-center text-xs text-muted-foreground">
          These are interactive mockups of the Everlumen interface, rendered with sample project
          data.
        </p>
      </div>
    </section>
  );
}

function DemoFeatures() {
  return (
    <section className="bg-background py-16 md:py-24">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {featureTiles.map((f) => (
            <div
              key={f.title}
              className="rounded-[24px] border-[0.8px] border-border bg-card/50 p-7"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Check className="h-5 w-5" />
              </span>
              <h2 className="font-manrope mt-4 text-lg font-bold text-foreground">{f.title}</h2>
              <p className="font-manrope mt-2 text-sm leading-6 text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Button asChild size="lg" className="font-manrope rounded-lg px-7 text-sm font-bold">
            <Link to="/signup">
              Start your 14-day free trial <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
