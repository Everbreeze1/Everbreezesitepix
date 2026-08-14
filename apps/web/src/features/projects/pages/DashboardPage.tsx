import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { supabase } from "@/integrations/sitepix/client";
import { getMyTeam } from "@/lib/teams.functions";
import { CaptureUpdateDialog } from "@/components/CaptureUpdateDialog";
import type { ProjectPickerRow } from "@/features/projects/components/CreateGroupDialog";
import { qk } from "@/lib/query-keys";

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
  status: string;
  updated_at: string;
}

interface ActiveProjectCard extends ProjectRow {
  photoCount: number;
  coverUrl: string;
  lastPhotoAt: string | null;
}

interface ActivityItem {
  key: string;
  kind: "photos" | "report";
  text: string;
  at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

function projectLocation(p: ProjectRow): string | null {
  if (p.location && p.location.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x): x is string => !!x && x.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile } = useProfile();
  const { guard } = useSubscriptionGate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [activeCards, setActiveCards] = useState<ActiveProjectCard[]>([]);
  const [newRecordsCount, setNewRecordsCount] = useState(0);
  const [docHealthPct, setDocHealthPct] = useState<number | null>(null);
  const [weekCounts, setWeekCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);

  const firstName =
    profile?.full_name?.split(" ")[0] ??
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    user?.email?.split("@")[0] ??
    "there";

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const today = useMemo(
    () =>
      new Date()
        .toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
        .toUpperCase(),
    [],
  );

  const query = useQuery({
    queryKey: qk.dashboard(user?.id ?? ""),
    queryFn: load,
    enabled: !!user,
    staleTime: 60_000,
  });

  // Local useState mirrors query.data so a cache-hit remount (queryFn
  // skipped, data served straight from cache) still repopulates the page -
  // a plain useState reset on mount would otherwise leave everything empty
  // until the next refetch.
  useEffect(() => {
    if (query.data) {
      setProjects(query.data.projects);
      setActiveCards(query.data.activeCards);
      setNewRecordsCount(query.data.newRecordsCount);
      setDocHealthPct(query.data.docHealthPct);
      setWeekCounts(query.data.weekCounts);
      setActivity(query.data.activity);
    }
  }, [query.data]);

  const loading = query.isPending;

  async function load(): Promise<{
    projects: ProjectRow[];
    activeCards: ActiveProjectCard[];
    newRecordsCount: number;
    docHealthPct: number | null;
    weekCounts: number[];
    activity: ActivityItem[];
  }> {
    const { data: projectList } = await (supabase as any)
      .from("projects")
      .select("id, name, city, state, street, location, status, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    const all = (projectList as ProjectRow[]) ?? [];
    const activeProjects = all.filter((p) => p.status === "active");
    const topActive = activeProjects.slice(0, 2);

    const [
      cardsResult,
      newRecordsResult,
      weekPhotosResult,
      healthResult,
      recentPhotosResult,
      recentReportsResult,
    ] = await Promise.all([
      loadActiveCards(topActive),
      // Every `photos` read excludes the trash by hand - the soft delete has no
      // database-level enforcement. Without it these stats counted photos the
      // crew had already deleted, and the activity feed listed them.
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from("photos")
        .select("created_at")
        .is("deleted_at", null)
        .gte("created_at", new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString()),
      activeProjects.length
        ? (supabase as any)
            .from("photos")
            .select("project_id")
            .in(
              "project_id",
              activeProjects.map((p) => p.id),
            )
            .is("deleted_at", null)
            .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        : Promise.resolve({ data: [] }),
      (supabase as any)
        .from("photos")
        .select("project_id, uploaded_by, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(30),
      (supabase as any)
        .from("project_reports")
        .select("id, project_id, created_by, created_at, title")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const buckets = [0, 0, 0, 0, 0, 0, 0];
    ((weekPhotosResult.data as Array<{ created_at: string }>) ?? []).forEach((row) => {
      const days = Math.floor(
        (Date.now() - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000),
      );
      const idx = 6 - days;
      if (idx >= 0 && idx < 7) buckets[idx] += 1;
    });

    const docHealthPct = activeProjects.length
      ? Math.round(
          (new Set(
            ((healthResult.data as Array<{ project_id: string }>) ?? []).map((r) => r.project_id),
          ).size /
            activeProjects.length) *
            100,
        )
      : null;

    const activity = await loadActivity(
      all,
      recentPhotosResult.data ?? [],
      recentReportsResult.data ?? [],
    );

    return {
      projects: all,
      activeCards: cardsResult,
      newRecordsCount: newRecordsResult.count ?? 0,
      docHealthPct,
      weekCounts: buckets,
      activity,
    };
  }

  async function loadActiveCards(topActive: ProjectRow[]): Promise<ActiveProjectCard[]> {
    if (!topActive.length) return [];
    const ids = topActive.map((p) => p.id);
    const { data } = await supabase
      .from("photos")
      .select("project_id, storage_path, image_url, created_at")
      .in("project_id", ids)
      // Excludes the trash: without it the newest deleted photo became the
      // project's cover image on the dashboard.
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const rows =
      (data as Array<{
        project_id: string;
        storage_path: string;
        image_url: string | null;
        created_at: string;
      }>) ?? [];
    const countByProject: Record<string, number> = {};
    const firstByProject: Record<
      string,
      { storage_path: string; image_url: string | null; created_at: string }
    > = {};
    rows.forEach((r) => {
      countByProject[r.project_id] = (countByProject[r.project_id] ?? 0) + 1;
      if (!firstByProject[r.project_id]) firstByProject[r.project_id] = r;
    });

    const needSign = Object.values(firstByProject)
      .filter((f) => !f.image_url)
      .map((f) => f.storage_path);
    const signedMap: Record<string, string> = {};
    if (needSign.length) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(needSign, 60 * 60);
      signed?.forEach((s, i) => {
        if (s.signedUrl) signedMap[needSign[i]] = s.signedUrl;
      });
    }

    return topActive.map((p) => {
      const cover = firstByProject[p.id];
      return {
        ...p,
        photoCount: countByProject[p.id] ?? 0,
        coverUrl: cover ? (cover.image_url ?? signedMap[cover.storage_path] ?? "") : "",
        lastPhotoAt: cover?.created_at ?? null,
      };
    });
  }

  async function loadActivity(
    allProjects: ProjectRow[],
    photoRows: Array<{ project_id: string; uploaded_by: string | null; created_at: string }>,
    reportRows: Array<{
      id: string;
      project_id: string;
      created_by: string | null;
      created_at: string;
      title: string | null;
    }>,
  ): Promise<ActivityItem[]> {
    const projNameById = new Map(allProjects.map((p) => [p.id, p.name]));

    const photoGroups: Record<
      string,
      { project_id: string; uploaded_by: string | null; count: number; latest: string }
    > = {};
    photoRows.forEach((r) => {
      const key = `${r.uploaded_by ?? "unknown"}:${r.project_id}`;
      const g = photoGroups[key];
      if (g) {
        g.count += 1;
        if (r.created_at > g.latest) g.latest = r.created_at;
      } else {
        photoGroups[key] = {
          project_id: r.project_id,
          uploaded_by: r.uploaded_by,
          count: 1,
          latest: r.created_at,
        };
      }
    });

    const uploaderIds = Array.from(
      new Set([
        ...Object.values(photoGroups)
          .map((g) => g.uploaded_by)
          .filter((x): x is string => !!x),
        ...reportRows.map((r) => r.created_by).filter((x): x is string => !!x),
      ]),
    );
    /*
     * Names come from the team RPC, not from `profiles`.
     *
     * Team photos genuinely reach this browser - the photos and projects RLS
     * policies are teammate-scoped - so a teammate's upload arrived with their
     * uuid attached. But resolving that uuid went through `profiles`, which
     * lets you read only your OWN row, so `nameById` never held anyone else and
     * every teammate's activity rendered as "Someone".
     */
    const nameById: Record<string, string> = {};
    if (uploaderIds.length) {
      const team = await getMyTeam().catch(() => null);
      for (const m of ((team as any)?.members ?? []) as any[]) {
        const full = m.profile?.full_name;
        if (full) nameById[m.user_id] = String(full).split(" ")[0];
      }
    }

    const photoItems: ActivityItem[] = Object.entries(photoGroups).map(([key, g]) => {
      const who = (g.uploaded_by && nameById[g.uploaded_by]) || "Someone";
      const proj = projNameById.get(g.project_id) ?? "a project";
      return {
        key: `photos:${key}`,
        kind: "photos",
        text: `${who} added ${g.count} photo${g.count === 1 ? "" : "s"} to ${proj}`,
        at: g.latest,
      };
    });

    const reportItems: ActivityItem[] = reportRows.map((r) => {
      const who = (r.created_by && nameById[r.created_by]) || "Someone";
      const proj = projNameById.get(r.project_id) ?? "a project";
      return {
        key: `report:${r.id}`,
        kind: "report",
        text: `${who} created a report for ${proj}`,
        at: r.created_at,
      };
    });

    return [...photoItems, ...reportItems].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 3);
  }

  const projectPickerRows: ProjectPickerRow[] = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name, location: projectLocation(p) })),
    [projects],
  );

  const activeCount = projects.filter((p) => p.status === "active").length;
  const primaryState = activeCards.find((p) => p.state)?.state;
  const maxWeekCount = Math.max(1, ...weekCounts);
  const weekdayLabel = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toLocaleDateString(
    undefined,
    { weekday: "short" },
  );

  return (
    <div className="min-h-full bg-background px-6 pb-24 pt-6 sm:px-10 sm:pt-10">
      {/* Greeting hero */}
      <div className="relative overflow-hidden rounded-[32px] border border-border bg-card p-8 sm:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-[64px]" />
        <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <div className="max-w-[448px]">
            <p className="font-manrope text-xs font-extrabold uppercase tracking-[1.92px] text-primary">
              {today}
            </p>
            <h1 className="font-display mt-4 text-5xl font-bold leading-none tracking-[-2.1px] text-foreground sm:text-6xl">
              {greeting}, {firstName}.
            </h1>
            <p className="font-manrope mt-5 text-sm leading-6 text-muted-foreground">
              Your crews are documenting steadily. Here is the field record that needs your
              attention today.
            </p>
          </div>
          <Button
            disabled={loading}
            onClick={() =>
              guard(
                () =>
                  projects.length === 0 ? navigate({ to: "/projects/new" }) : setCaptureOpen(true),
                "Subscribe to capture new field updates.",
              )
            }
            className="font-manrope w-fit rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Camera className="h-4 w-4" /> Capture update
          </Button>
        </div>

        <div className="relative mt-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-muted p-4">
            <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[1.3px] text-muted-foreground">
              Active projects
            </p>
            <p className="font-display mt-3 text-4xl font-bold leading-none tracking-[-1.26px] text-foreground">
              {activeCount}
            </p>
            <p className="font-manrope mt-2 text-xs font-bold text-muted-foreground">
              {primaryState ? `Across ${primaryState}` : "Across your job sites"}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted p-4">
            <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[1.3px] text-muted-foreground">
              New field records
            </p>
            <p className="font-display mt-3 text-4xl font-bold leading-none tracking-[-1.26px] text-foreground">
              {newRecordsCount}
            </p>
            <p className="font-manrope mt-2 text-xs font-bold text-muted-foreground">
              Since yesterday
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted p-4">
            <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[1.3px] text-muted-foreground">
              Documentation health
            </p>
            <p className="font-display mt-3 text-4xl font-bold leading-none tracking-[-1.26px] text-foreground">
              {docHealthPct === null ? "-" : `${docHealthPct}%`}
            </p>
            <p className="font-manrope mt-2 text-xs font-bold text-muted-foreground">
              Documented this week
            </p>
          </div>
        </div>
      </div>

      {/* Active projects */}
      {!loading && activeCards.length > 0 && (
        <div className="mt-9">
          <div className="flex items-end justify-between gap-5">
            <div>
              <p className="font-manrope text-[11px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
                On site now
              </p>
              <h2 className="font-manrope mt-2 text-xl font-extrabold tracking-[-0.5px] text-foreground">
                Active projects
              </h2>
            </div>
            <Link to="/map" className="font-manrope text-sm font-extrabold text-primary">
              View map →
            </Link>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {activeCards.map((p, i) => (
              <Link
                key={p.id}
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                search={{} as any}
                className={`group relative block h-[255px] overflow-hidden rounded-3xl shadow-[0_22px_40px_-28px_rgba(16,25,41,0.65)] ${i === 0 ? "lg:col-span-2" : ""}`}
              >
                {p.coverUrl ? (
                  <img
                    src={p.coverUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 bg-muted" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-sidebar via-sidebar/25 to-transparent" />
                <div className="relative flex h-full flex-col justify-between p-5">
                  <span className="font-manrope w-fit rounded-full bg-[#34D399] px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[1.2px] text-sidebar">
                    {p.status === "active" ? "Active" : p.status}
                  </span>
                  <div>
                    <p className="font-display text-3xl font-bold leading-none tracking-[-1.05px] text-sidebar-foreground">
                      {p.name}
                    </p>
                    <p className="font-manrope mt-2 text-xs font-bold text-sidebar-foreground/65">
                      {p.photoCount} photo{p.photoCount === 1 ? "" : "s"} ·{" "}
                      {p.lastPhotoAt ? timeAgo(p.lastPhotoAt) : timeAgo(p.updated_at)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Activity + crew pulse */}
      <div className="mt-9 grid gap-5 lg:grid-cols-[1fr_420px]">
        <div className="rounded-3xl border border-border bg-card p-6">
          <p className="font-manrope text-[11px] font-extrabold uppercase tracking-[1.5px] text-muted-foreground">
            Live record
          </p>
          <h2 className="font-manrope mt-2 text-xl font-extrabold tracking-[-0.5px] text-foreground">
            Latest field activity
          </h2>
          <div className="mt-5 space-y-2">
            {activity.length === 0 && !loading && (
              <p className="font-manrope rounded-2xl bg-muted p-4 text-sm text-muted-foreground">
                No field activity yet. Capture your first update to see it here.
              </p>
            )}
            {activity.map((item) => (
              <div key={item.key} className="flex items-center gap-4 rounded-2xl bg-muted p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
                  {item.kind === "report" ? (
                    <FileText className="h-4 w-4" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-manrope truncate text-sm font-extrabold text-foreground">
                    {item.text}
                  </p>
                  <p className="font-manrope mt-1 text-xs text-muted-foreground">
                    {timeAgo(item.at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-manrope text-lg font-extrabold text-foreground">Crew pulse</h2>
          <p className="font-manrope mt-1 text-sm text-muted-foreground">Work captured this week</p>
          <div className="mt-7 flex h-[221px] items-end gap-2">
            {weekCounts.map((c, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[4px] bg-primary/20"
                style={{ height: `${c === 0 ? 4 : Math.max(16, (c / maxWeekCount) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-4 flex items-start justify-between">
            <span className="font-manrope text-xs font-bold text-muted-foreground">
              {weekdayLabel}
            </span>
            <span className="font-manrope text-xs font-bold text-muted-foreground">Today</span>
          </div>
        </div>
      </div>

      <CaptureUpdateDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        projects={projectPickerRows}
      />
    </div>
  );
}
