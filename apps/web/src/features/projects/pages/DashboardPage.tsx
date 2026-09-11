import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, FileText, Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REFERENCE_CARD, REFERENCE_CARD_INTERACTIVE, REFERENCE_PAGE, REFERENCE_SUBTITLE, REFERENCE_TITLE, ReferencePill } from "@/components/ui/reference";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { supabase } from "@/integrations/everlumen/client";
import { getMyTeam } from "@/lib/teams.functions";
import { CaptureUpdateDialog } from "@/components/CaptureUpdateDialog";
import { AccountSetupCard } from "@/features/settings/components/AccountSetupCard";
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
  const { profile, loading: profileLoading } = useProfile();
  const { guard } = useSubscriptionGate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [activeCards, setActiveCards] = useState<ActiveProjectCard[]>([]);
  const [newRecordsCount, setNewRecordsCount] = useState(0);
  const [docHealthPct, setDocHealthPct] = useState<number | null>(null);
  const [weekCounts, setWeekCounts] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  /*
   * "Needs review" is the count of photos that are still untagged - the same
   * definition the project's Photos tab uses for its "Needs review" filter
   * (untagged photos need a human to look at them before a report ships).
   */
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [captureOpen, setCaptureOpen] = useState(false);

  /*
   * The profile row is the only thing allowed to name the person here.
   *
   * This used to fall back to `user_metadata.full_name` and then to the email
   * local part while the profile was loading. Neither is kept in step with
   * Settings: the auth copy is whatever was typed at signup and is never
   * rewritten. So a user who had since renamed themselves got greeted by the
   * signup name for a beat, and watched it change once the row arrived.
   *
   * Null while the row is still on its way, and the heading renders that state
   * rather than inventing a name for it.
   */
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || null;

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
      setNeedsReviewCount(query.data.needsReviewCount);
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
    needsReviewCount: number;
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
      needsReviewResult,
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
      // Untagged photos = "Needs review" (matches the Photos tab's filter).
      supabase
        .from("photos")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .or("tags.is.null,tags.eq.{}"),
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
      needsReviewCount: needsReviewResult.count ?? 0,
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
    <div className="min-h-full bg-background">
      <div className="mx-auto w-full max-w-[1200px] px-6 pb-10 pt-8 sm:px-10">
        {/* Above the greeting, and only until it is answered or dismissed - see
            AccountSetupCard, which renders nothing in every other case. */}
        <AccountSetupCard className="mb-5" />

        {/* Search + Capture update */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex h-10 w-[320px] items-center gap-2.5 rounded-[10px] border border-border bg-card px-3.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-faint" />
            <span className="text-[13px] text-faint">Search projects, photos, reports...</span>
          </div>
          <div className="flex items-center gap-4">
            <Bell className="h-[19px] w-[19px] shrink-0 text-muted-foreground" aria-hidden />
            <Button
              disabled={loading}
              onClick={() =>
                guard(
                  () =>
                    projects.length === 0 ? navigate({ to: "/projects/new" }) : setCaptureOpen(true),
                  "Subscribe to capture new field updates.",
                )
              }
              className="font-sans h-[38px] rounded-lg bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              <Camera className="h-4 w-4" /> Capture update
            </Button>
          </div>
        </div>

        {/* Greeting */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1
              aria-busy={!firstName && profileLoading}
              className={REFERENCE_TITLE}
            >
              {firstName ? `${greeting}, ${firstName}.` : profileLoading ? greeting : `${greeting}.`}
            </h1>
            <span className="font-mono inline-flex items-center rounded-full border border-border bg-card px-2.5 py-[3px] text-[11px] font-medium tracking-[0.04em] text-muted-foreground">
              {today}
            </span>
          </div>
          <p className={cn(REFERENCE_SUBTITLE, "mt-1")}>
            Here's where every job on the board stands today.
          </p>
        </div>

        {/* Stat cards */}
        <div className="mt-6 grid grid-cols-2 gap-[14px] lg:grid-cols-4">
          <div className="rounded-[12px] border border-border bg-card p-[18px_20px]">
            <div className="text-xs text-muted-foreground">Active projects</div>
            <div className="font-mono mt-1.5 text-[26px] font-bold leading-none text-foreground">
              {activeCount}
            </div>
          </div>
          <div className="rounded-[12px] border border-border bg-card p-[18px_20px]">
            <div className="text-xs text-muted-foreground">New field records</div>
            <div className="font-mono mt-1.5 text-[26px] font-bold leading-none text-foreground">
              {newRecordsCount} <span className="text-xs font-normal text-faint">today</span>
            </div>
          </div>
          <div className="rounded-[12px] border border-border bg-card p-[18px_20px]">
            <div className="text-xs text-muted-foreground">Documentation health</div>
            <div className="font-mono mt-1.5 text-[26px] font-bold leading-none text-foreground">
              {docHealthPct === null ? "—" : `${docHealthPct}%`}
            </div>
          </div>
          <div className="rounded-[12px] border border-status-hold bg-status-hold-soft p-[18px_20px]">
            <div className="text-xs text-muted-foreground">Needs review</div>
            <div className="font-mono mt-1.5 text-[26px] font-bold leading-none text-status-hold">
              {needsReviewCount}
            </div>
          </div>
        </div>
{/* On site now + Needs attention */}
        <div className="mt-7 flex flex-col gap-[22px] lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[15px] font-semibold text-foreground">On site now</h2>
              <Link to="/projects" className="text-[12.5px] font-semibold text-primary">
                View all projects &rarr;
              </Link>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {!loading && activeCards.length === 0 && (
                <p className="rounded-[12px] border border-border bg-card p-4 text-sm text-muted-foreground">
                  Your active projects will show here once work starts. Create a project to begin.
                </p>
              )}
              {activeCards.map((p) => {
                const tone: "active" | "hold" | "complete" | "archived" =
                  p.status === "completed"
                    ? "complete"
                    : p.status === "hold" || p.status === "on-hold"
                      ? "hold"
                      : "active";
                return (
                  <Link
                    key={p.id}
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    search={{} as any}
                    className="flex items-center gap-3.5 rounded-[12px] border border-border bg-card px-4 py-[15px] transition-colors hover:border-primary"
                  >
                    <div className="h-[44px] w-[44px] shrink-0 rounded-lg bg-secondary" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-foreground">
                        {p.name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {projectLocation(p) || "Site"} &middot; HVAC Service Call blueprint
                      </div>
                    </div>
                    <ReferencePill tone={tone}>
                      {p.status === "completed" ? "Completed" : p.status === "hold" ? "On hold" : "Active"}
                    </ReferencePill>
                    <div className="flex -space-x-1.5">
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#4a5568] text-[9px] font-bold text-white ring-2 ring-card">AJ</span>
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#2f6f4f] text-[9px] font-bold text-white ring-2 ring-card">JB</span>
                    </div>
                    <div className="w-[74px] shrink-0 text-right text-[11.5px] text-faint">
                      {p.lastPhotoAt ? timeAgo(p.lastPhotoAt) : timeAgo(p.updated_at)}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="w-full max-w-[320px] shrink-0 lg:w-[320px]">
            <h2 className="text-[15px] font-semibold text-foreground">Needs attention</h2>
            <div className="mt-3 rounded-[12px] border border-border bg-card">
              {activity.length === 0 && !loading && (
                <p className="px-4 py-8 text-center text-[12.5px] text-faint">
                  Nothing needs attention right now.
                </p>
              )}
              {activity.map((item) => (
                <div
                  key={item.key}
                  className="flex items-start gap-[11px] border-b border-border px-4 py-3 last:border-b-0"
                >
                  {item.kind === "report" ? (
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
                  ) : (
                    <Camera className="mt-0.5 h-4 w-4 shrink-0 text-status-hold" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium leading-snug text-foreground">
                      {item.text}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-faint">{timeAgo(item.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <CaptureUpdateDialog
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          projects={projectPickerRows}
        />
      </div>
    </div>
  );
}