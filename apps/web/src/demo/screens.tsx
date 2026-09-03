import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Camera,
  Check,
  Clock,
  Download,
  FileText,
  Filter,
  FolderKanban,
  HardHat,
  LayoutGrid,
  ListChecks,
  MapPin,
  Plus,
  Search,
  Share2,
  Sparkles,
  Tag,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DEMO_COMPANY,
  demoActivity,
  demoByProject,
  demoCrew,
  demoPhotos,
  demoProjectById,
  demoProjects,
  demoReports,
  demoWeekCounts,
  type DemoActivityItem,
  type DemoCrewMember,
  type DemoPhoto,
  type DemoProject,
  type DemoProjectStatus,
} from "@/demo/fixtures";
import { cn } from "@/lib/utils";

/** Shared visual language - the app's rounded-2xl bordered card treatment. */
const panelClass = "rounded-2xl border border-border bg-card/60";
const sectionLabel =
  "font-manrope text-[11px] font-extrabold uppercase tracking-[1.6px] text-muted-foreground";

/* ------------------------------------------------------------------ helpers */

const STATUS_META: Record<
  DemoProjectStatus,
  { label: string; dot: string; chip: string; chipOnImage: string }
> = {
  active: {
    label: "Active",
    dot: "bg-emerald-400",
    chip: "bg-emerald-500/10 text-emerald-600",
    chipOnImage: "bg-emerald-400/90 text-emerald-950",
  },
  on_hold: {
    label: "On hold",
    dot: "bg-amber-400",
    chip: "bg-amber-500/10 text-amber-600",
    chipOnImage: "bg-amber-400/90 text-amber-950",
  },
  completed: {
    label: "Completed",
    dot: "bg-[#101929]/85",
    chip: "bg-muted text-foreground",
    chipOnImage: "bg-black/50 text-white",
  },
};

function StatusBadge({
  status,
  onImage = false,
}: {
  status: DemoProjectStatus;
  onImage?: boolean;
}) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        onImage ? m.chipOnImage : m.chip,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", onImage ? "bg-current" : m.dot)} />
      {m.label}
    </span>
  );
}

function CrewStack({ people, max = 4 }: { people: DemoCrewMember[]; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((c, i) => (
        <span
          key={c.initials}
          title={c.name}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-foreground text-[8px] font-extrabold text-background",
            i > 0 && "-ml-1.5",
          )}
        >
          {c.initials}
        </span>
      ))}
      {rest > 0 && (
        <span className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-extrabold text-muted-foreground">
          +{rest}
        </span>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<DemoActivityItem["icon"], LucideIcon> = {
  camera: Camera,
  sparkles: Sparkles,
  tag: Tag,
  list: ListChecks,
  video: Video,
};

function projectLocation(p: DemoProject): string {
  return [p.street, `${p.city}, ${p.state}`].filter(Boolean).join(" · ");
}

function PhotoTile({
  photo,
  projectName,
  onClick,
}: {
  photo: DemoPhoto;
  projectName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={projectName}
      className="group relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border bg-muted text-left"
    >
      <img
        src={photo.src}
        alt={photo.caption}
        loading="lazy"
        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
      />
      <span className="absolute left-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium capitalize text-white backdrop-blur-sm">
        {photo.phase}
      </span>
      <span className="absolute right-1.5 top-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur-sm">
        {photo.taken}
      </span>
      <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-[11px] leading-tight text-white">
        {photo.caption}
      </span>
    </button>
  );
}

function DemoLightbox({
  photo,
  projectName,
  onClose,
}: {
  photo: DemoPhoto;
  projectName: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="flex items-center justify-between">
        <p className="font-manrope text-xs font-bold uppercase tracking-wide text-white/70">
          {projectName}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label="Close photo"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      <img
        src={photo.src}
        alt={photo.caption}
        className="mx-auto min-h-0 flex-1 object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="mt-3 text-center text-xs text-white/80">
        <p className="text-sm text-white">
          {photo.caption} · <span className="capitalize">{photo.phase}</span>
        </p>
        <p className="mt-0.5 text-white/60">{photo.taken}</p>
      </div>
    </div>
  );
}

function ScreenHeading({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-8">
      <div>
        {eyebrow && (
          <p className="font-manrope text-[11px] font-extrabold uppercase tracking-[1.6px] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display mt-0.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {subtitle && <p className="font-manrope mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

function InertButton({
  children,
  title = "Part of the full Everlumen app",
  icon: Icon,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  icon?: LucideIcon;
  onClick?: () => void;
}) {
  return (
    <Button
      type="button"
      variant={onClick ? "default" : "outline"}
      size="sm"
      title={title}
      onClick={onClick}
      className="font-manrope rounded-lg text-xs font-bold"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </Button>
  );
}

/* --------------------------------------------------------------- Overview */

/** Right rail for Overview - no state of its own, so it can be a sibling. */
function OverviewSideColumn() {
  return (
    <aside className="space-y-6">
      <section className={panelClass}>
        <h2 className={cn(sectionLabel, "px-5 pt-5")}>Latest activity</h2>
        <ul className="mt-2 space-y-0 px-3 pb-3">
          {demoActivity.map((a) => {
            const Icon = ACTIVITY_ICON[a.icon];
            return (
              <li
                key={a.text}
                className="flex gap-3 rounded-xl px-2 py-3 transition hover:bg-accent/50"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="font-manrope text-[13px] leading-snug text-foreground">{a.text}</p>
                  <p className="font-manrope mt-0.5 text-[11px] text-muted-foreground">{a.when}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={panelClass}>
        <h2 className={cn(sectionLabel, "px-5 pt-5")}>On site today</h2>
        <ul className="mt-2 space-y-1 px-3 pb-3">
          {demoCrew.map((c, i) => (
            <li key={c.name} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-[10px] font-extrabold text-background">
                {c.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-manrope truncate text-[13px] font-bold text-foreground">
                  {c.name}
                </p>
                <p className="font-manrope text-[11px] text-muted-foreground">{c.role}</p>
              </div>
              {i < 3 ? (
                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> On site
                </span>
              ) : (
                <span className="text-[10px] font-bold text-muted-foreground">Remote</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

export function OverviewScreen({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [lightbox, setLightbox] = useState<DemoPhoto | null>(null);
  const today = new Date()
    .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();
  const weekTotal = demoWeekCounts.reduce((a, b) => a + b, 0);
  const activeProjects = demoProjects.filter((p) => p.status === "active");

  return (
    <div className="mx-auto max-w-[1080px] space-y-6 px-4 py-6 sm:px-8">
      <div>
        <p className={sectionLabel}>{today}</p>
        <h1 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground">
          Good morning, Marcus
        </h1>
        <p className="font-manrope mt-1 text-sm text-muted-foreground">
          Here is what is moving across your jobs today.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          icon={Camera}
          value={weekTotal.toLocaleString()}
          label="Photos this week"
          note="+12% vs last week"
        />
        <StatTile
          icon={FolderKanban}
          value={String(activeProjects.length)}
          label="Active jobs"
          note="2 crews on site"
        />
        <StatTile icon={HardHat} value="9" label="On site today" note="4 sites reporting" />
        <StatTile icon={FileText} value="87%" label="Docs health" note="14 of 16 on track" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <OverviewMain onOpenProject={onOpenProject} onOpenPhoto={(p) => setLightbox(p)} />
        <OverviewSideColumn />
      </div>

      {lightbox && (
        <DemoLightbox
          photo={lightbox}
          projectName={demoProjectById(lightbox.projectId).name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function OverviewMain({
  onOpenProject,
  onOpenPhoto,
}: {
  onOpenProject: (id: string) => void;
  onOpenPhoto: (photo: DemoPhoto) => void;
}) {
  const weekly = demoWeekCounts;
  const maxDay = Math.max(...weekly);
  const latestPhotos = demoPhotos.slice(0, 6);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className={sectionLabel}>Active projects</h2>
          <button
            type="button"
            onClick={() => onOpenProject(demoProjects[0].id)}
            className="font-manrope flex items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            See all <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {demoProjects
            .filter((p) => p.status === "active")
            .map((p) => (
              <ActiveProjectCard key={p.id} project={p} onClick={() => onOpenProject(p.id)} />
            ))}
        </div>
      </section>

      <section className={panelClass}>
        <div className="px-5 pt-5">
          <h2 className={sectionLabel}>Photos this week</h2>
          <p className="font-manrope mt-1 text-xs text-muted-foreground">
            {weekly.reduce((a, b) => a + b, 0).toLocaleString()} captured ·{" "}
            {weekly[weekly.length - 1]} so far today
          </p>
        </div>
        <div className="flex h-32 items-end gap-2 px-5 pb-5 pt-4">
          {weekly.map((v, i) => {
            const isToday = i === weekly.length - 1;
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={cn(
                      "w-full rounded-t-md transition-all",
                      isToday ? "bg-primary" : "bg-primary/25",
                    )}
                    style={{ height: `${Math.max(8, (v / maxDay) * 100)}%` }}
                  />
                </div>
                <span className="font-manrope text-[10px] font-bold text-muted-foreground">
                  {["M", "T", "W", "T", "F", "S", "S"][i]}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className={sectionLabel}>Latest photos</h2>
          <span className="font-manrope text-xs font-bold text-muted-foreground">
            Tap a photo to open it
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {latestPhotos.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              projectName={demoProjectById(photo.projectId).name}
              onClick={() => onOpenPhoto(photo)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  note,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  note: string;
}) {
  return (
    <div className={cn(panelClass, "flex items-center gap-3 p-4")}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-bold leading-none tracking-tight text-foreground">
          {value}
        </p>
        <p className="font-manrope mt-1 truncate text-xs font-bold text-foreground">{label}</p>
        <p className="font-manrope truncate text-[11px] text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}

function ActiveProjectCard({ project, onClick }: { project: DemoProject; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        panelClass,
        "group overflow-hidden p-0 text-left transition hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <img
          src={project.cover}
          alt=""
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute left-3 top-3">
          <StatusBadge status={project.status} onImage />
        </div>
        <div className="absolute bottom-3 left-3 right-3 text-white">
          <p className="font-manrope truncate text-sm font-bold">{project.name}</p>
          <p className="font-manrope mt-0.5 truncate text-[11px] text-white/85">
            {projectLocation(project)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between px-4 py-3 text-[11px] font-bold text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5" />
          {project.photoCount.toLocaleString()} photos
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {project.updatedAgo}
        </span>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------- Projects */

export function ProjectsScreen({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = demoProjects.filter((p) =>
    [p.name, p.street, p.city].join(" ").toLowerCase().includes(q),
  );

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-8">
      <ScreenHeading
        eyebrow={DEMO_COMPANY}
        title="Projects"
        subtitle="All your jobs, one record. Click a project to open its photo log."
        actions={<InertButton icon={Plus}>New project</InertButton>}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <StatPill count={2} label="Active" tone="text-emerald-600" />
        <StatPill count={2} label="Completed" tone="text-foreground" />
        <StatPill count={1} label="On hold" tone="text-amber-600" />
        <StatPill count={12} label="Archived" tone="text-muted-foreground" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search demo projects"
            className="w-full bg-transparent font-manrope text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>
        <InertButton icon={Filter}>Filters</InertButton>
        <InertButton>Sort</InertButton>
      </div>

      <div className="mt-5 flex items-center gap-1 border-b border-border">
        <TabStripButton active>All projects</TabStripButton>
        {["Groups", "Boards", "Schedule"].map((t) => (
          <TabStripButton key={t} title="Part of the full Everlumen app">
            {t}
          </TabStripButton>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {filtered.map((p) => (
          <ProjectCard key={p.id} project={p} onClick={() => onOpenProject(p.id)} />
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="font-manrope mt-8 text-center text-sm text-muted-foreground">
          No projects match “{query}”.
        </p>
      )}
    </div>
  );
}

function StatPill({ count, label, tone }: { count: number; label: string; tone: string }) {
  return (
    <button
      type="button"
      className="font-manrope rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-bold text-muted-foreground transition hover:border-primary/40"
      title="Part of the full Everlumen app"
    >
      <span className={tone}>{count}</span> {label}
    </button>
  );
}

function TabStripButton({
  children,
  active,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={cn(
        "font-manrope -mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm font-bold transition-colors",
        active
          ? "border-primary text-foreground"
          : "cursor-default border-transparent text-muted-foreground/60 hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ProjectCard({ project, onClick }: { project: DemoProject; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        panelClass,
        "group flex gap-4 p-3 text-left transition hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl">
        <img
          src={project.cover}
          alt=""
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        <div className="absolute left-1.5 top-1.5">
          <StatusBadge status={project.status} onImage />
        </div>
      </div>
      <div className="min-w-0 flex-1 self-center">
        <p className="font-manrope truncate text-sm font-bold text-foreground">{project.name}</p>
        <p className="font-manrope mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0" />
          {projectLocation(project)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-muted-foreground">
          <span className="flex items-center gap-1">
            <Camera className="h-3 w-3" />
            {project.photoCount.toLocaleString()} photos
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {project.updatedAgo}
          </span>
          <span className="font-manrope ml-auto hidden items-center gap-0.5 text-xs font-bold text-primary opacity-0 transition group-hover:opacity-100 sm:flex">
            Open <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------- Project detail */

export function ProjectScreen({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const project = demoProjectById(projectId);
  const photos = demoByProject(projectId);
  const phases = ["All", ...Array.from(new Set(photos.map((p) => p.phase)))];
  const [phase, setPhase] = useState("All");
  const [lightbox, setLightbox] = useState<DemoPhoto | null>(null);
  const shown = phase === "All" ? photos : photos.filter((p) => p.phase === phase);

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-8">
      <button
        type="button"
        onClick={onBack}
        className="font-manrope flex items-center gap-1 text-xs font-bold text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All projects
      </button>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
              {project.name}
            </h1>
            <StatusBadge status={project.status} />
          </div>
          <p className="font-manrope mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {projectLocation(project)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <InertButton icon={Share2}>Share</InertButton>
          <InertButton icon={Download}>Download</InertButton>
          <InertButton icon={Sparkles}>AI Report</InertButton>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetaTile icon={Camera} label="Photos" value={project.photoCount.toLocaleString()} />
        <MetaTile icon={Sparkles} label="Phase" value={project.phase} />
        <MetaTile icon={CalendarDays} label="Started" value={project.startedLabel} />
        <div className={cn(panelClass, "flex items-center gap-3 px-4 py-3")}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <HardHat className="h-4 w-4" />
          </span>
          <div>
            <p className="font-manrope text-xs font-bold text-foreground">Crew</p>
            <CrewStack people={demoCrew} max={4} />
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {phases.map((ph) => {
          const count = ph === "All" ? photos.length : photos.filter((p) => p.phase === ph).length;
          return (
            <button
              key={ph}
              type="button"
              onClick={() => setPhase(ph)}
              className={cn(
                "font-manrope rounded-full border px-3 py-1.5 text-xs font-bold capitalize transition",
                phase === ph
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/60 text-muted-foreground hover:border-primary/40",
              )}
            >
              {ph} <span className="ml-0.5 opacity-70">{count}</span>
            </button>
          );
        })}
        <span className="font-manrope ml-auto hidden text-xs font-bold text-muted-foreground sm:block">
          Tap a photo to open it
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((photo) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            projectName={project.name}
            onClick={() => setLightbox(photo)}
          />
        ))}
      </div>

      {lightbox && (
        <DemoLightbox
          photo={lightbox}
          projectName={project.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function MetaTile({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className={cn(panelClass, "flex items-center gap-3 px-4 py-3")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="font-manrope text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="font-manrope truncate text-sm font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- Map */

export function MapScreen({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const activeCount = demoProjects.filter((p) => p.status === "active").length;
  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-8">
      <ScreenHeading
        eyebrow={DEMO_COMPANY}
        title="Maps"
        subtitle="Every job pinned in one view. The demo draws a stylised map — the live app renders real tiles."
        actions={<InertButton icon={Filter}>Filter</InertButton>}
      />

      <div className="relative mt-5 h-[380px] overflow-hidden rounded-2xl border border-border sm:h-[480px]">
        {/* Map base: palette + faux tiles, roads, park blocks, river */}
        <div className="absolute inset-0 bg-[#E3EBDD]" />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent 0 84px, #FFFFFF 84px 88px), repeating-linear-gradient(90deg, transparent 0 112px, #FFFFFF 112px 116px)",
            opacity: 0.6,
          }}
        />
        <div aria-hidden className="absolute inset-x-0 top-[28%] h-3 bg-white/90" />
        <div aria-hidden className="absolute inset-y-0 left-[64%] w-3 bg-white/90" />
        <div aria-hidden className="absolute inset-x-[8%] top-[72%] h-2 bg-white/80" />
        <div
          aria-hidden
          className="absolute left-[10%] top-[12%] h-24 w-40 rotate-[-14deg] rounded-[40%] bg-[#BFDCC2]"
        />
        <div
          aria-hidden
          className="absolute bottom-[6%] right-[4%] h-28 w-52 rotate-[8deg] rounded-[40%] bg-[#C4E0C7]"
        />
        <div
          aria-hidden
          className="absolute -right-6 top-[40%] h-56 w-16 rotate-[24deg] rounded-full bg-[#A8CAE8]/90"
        />

        {/* Project pins — click to open the demo project */}
        {demoProjects.map((p) => (
          <MapPinMarker key={p.id} project={p} onClick={() => onOpenProject(p.id)} />
        ))}

        <div className="absolute left-3 top-3 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-md">
          <p className="font-manrope text-xs font-bold text-foreground">
            {activeCount} active sites
          </p>
          <p className="font-manrope text-[10px] text-muted-foreground">Updated just now</p>
        </div>
        <div className="absolute right-3 top-3 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-md">
          <p className="font-manrope text-[10px] font-bold text-muted-foreground">
            <span className="text-[#2584F4]">●</span> Active&ensp;
            <span className="text-amber-500">●</span> On hold&ensp;
            <span className="text-slate-500">●</span> Completed
          </p>
        </div>
      </div>

      <p className="font-manrope mt-3 text-center text-xs text-muted-foreground">
        Click a pin to open its project · Live Google Maps tiles render in the full app
      </p>
    </div>
  );
}

function MapPinMarker({ project, onClick }: { project: DemoProject; onClick: () => void }) {
  const color =
    project.status === "active" ? "#2584F4" : project.status === "on_hold" ? "#F59E0B" : "#64748B";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${project.name} — open in the demo`}
      className="absolute z-10 -translate-x-1/2 -translate-y-full transition hover:scale-110"
      style={{ left: `${project.mapLeft}%`, top: `${project.mapTop}%` }}
    >
      <span
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold text-white shadow-md"
        style={{ backgroundColor: color }}
      >
        <MapPin className="h-3 w-3" />
        {project.city}
      </span>
      <span
        aria-hidden
        className="mx-auto block h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent"
        style={{ borderTopColor: color }}
      />
    </button>
  );
}

/* ---------------------------------------------------------------- Gallery */

export function GalleryScreen() {
  const [lightbox, setLightbox] = useState<DemoPhoto | null>(null);
  const options = ["All projects", ...demoProjects.map((p) => p.name)];
  const [projectFilter, setProjectFilter] = useState("All projects");
  const shown =
    projectFilter === "All projects"
      ? demoPhotos
      : demoPhotos.filter((p) => demoProjectById(p.projectId).name === projectFilter);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-8">
      <ScreenHeading
        eyebrow={DEMO_COMPANY}
        title="Gallery"
        subtitle="Every photo from every job, searchable and filterable."
        actions={
          selected.length > 0 ? (
            <InertButton>{selected.length} selected</InertButton>
          ) : (
            <InertButton>Select</InertButton>
          )
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label="Filter gallery by project"
          className="h-9 rounded-lg border border-border bg-card/70 px-3 font-manrope text-xs font-bold text-foreground focus:outline-none"
        >
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <InertButton icon={LayoutGrid}>Grid</InertButton>
        <InertButton title="Calendar view (part of the full Everlumen app)" icon={CalendarDays}>
          Calendar
        </InertButton>
        <span className="font-manrope ml-auto text-xs font-bold text-muted-foreground">
          {shown.length} photos
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((photo) => {
          const project = demoProjectById(photo.projectId);
          const isSelected = selected.includes(photo.id);
          return (
            <div key={photo.id} className="relative">
              <PhotoTile
                photo={photo}
                projectName={project.name}
                onClick={() => (selected.length ? toggle(photo.id) : setLightbox(photo))}
              />
              <button
                type="button"
                aria-label={isSelected ? "Deselect photo" : "Select photo"}
                onClick={() => toggle(photo.id)}
                className={cn(
                  "absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md border backdrop-blur-sm transition",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-white/70 bg-black/40 text-white/70 hover:bg-black/60 hover:text-white",
                )}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </button>
            </div>
          );
        })}
      </div>

      {lightbox && (
        <DemoLightbox
          photo={lightbox}
          projectName={demoProjectById(lightbox.projectId).name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Reports */

export function ReportsScreen() {
  const [openId, setOpenId] = useState(demoReports[0].id);
  const open = demoReports.find((r) => r.id === openId) ?? demoReports[0];
  const featured = demoReports[0];

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-8">
      <ScreenHeading
        eyebrow={DEMO_COMPANY}
        title="Reports"
        subtitle="AI-drafted progress reports, daily logs and field inspections from the photos your crews already took."
        actions={<InertButton icon={FileText}>New report</InertButton>}
      />

      <div className="mt-5 grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-2">
          <p className={cn(sectionLabel, "px-1")}>All reports</p>
          {demoReports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOpenId(r.id)}
              className={cn(
                "w-full rounded-xl border px-3 py-3 text-left transition",
                openId === r.id
                  ? "border-primary/50 bg-primary/5"
                  : "border-border bg-card/60 hover:border-primary/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-manrope truncate text-[13px] font-bold text-foreground">
                  {r.title}
                </p>
                <KindBadge kind={r.kind} />
              </div>
              <p className="font-manrope mt-1 text-[11px] text-muted-foreground">
                {r.generatedAgo}
              </p>
            </button>
          ))}
        </aside>

        <section className={panelClass + " p-5 sm:p-8"}>
          {/* Document header */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div>
              <p className={sectionLabel}>Progress report · {DEMO_COMPANY}</p>
              <h2 className="font-display mt-1 text-2xl font-bold tracking-tight text-foreground">
                {open.title}
              </h2>
              <p className="font-manrope mt-1 text-xs text-muted-foreground">{open.generatedAgo}</p>
            </div>
            <div className="flex gap-2">
              <InertButton icon={Share2}>Share</InertButton>
              <InertButton icon={Download}>Download PDF</InertButton>
            </div>
          </div>

          {/* Summary */}
          <div className="mt-5 rounded-xl bg-card/70 p-4">
            <p className={sectionLabel}>Summary</p>
            <p className="font-manrope mt-2 text-sm leading-6 text-foreground">{open.summary}</p>
          </div>

          {/* Highlights */}
          {open.highlights.length > 0 && (
            <div className="mt-5">
              <p className={sectionLabel}>Key points</p>
              <ul className="mt-2 space-y-2">
                {open.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2.5">
                    <span className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="h-3 w-3 text-emerald-600" />
                    </span>
                    <span className="font-manrope text-sm leading-6 text-foreground">{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Photo evidence strip */}
          <div className="mt-6">
            <p className={sectionLabel}>Photo evidence</p>
            <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {demoByProject("maple")
                .slice(0, 4)
                .map((photo) => (
                  <div
                    key={photo.id}
                    className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border"
                  >
                    <img
                      src={photo.src}
                      alt={photo.caption}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-[9px] leading-tight text-white">
                      {photo.caption}
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Notes */}
          {open.notes.length > 0 && (
            <div className="mt-6">
              <p className={sectionLabel}>Notes & follow-ups</p>
              <ul className="mt-2 space-y-1.5">
                {open.notes.map((n) => (
                  <li key={n} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="font-manrope mt-8 border-t border-border pt-4 text-center text-[11px] text-muted-foreground">
            Sample report rendered for the demo —{" "}
            {featured.kind === "AI" ? "generated by AI" : "written in the full app"} with the photos
            above. {DEMO_COMPANY} · 2026
          </p>
        </section>
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: "AI" | "Manual" }) {
  return (
    <span
      className={cn(
        "font-manrope rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide",
        kind === "AI" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {kind}
    </span>
  );
}
