import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { PhotoThumb } from "@/components/PhotoThumb";
import {
  Camera,
  FolderKanban,
  FileText,
  Plus,
  MapPin,
  Clock,
  Star,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
  ImageOff,
  RefreshCw,
  Search,
  FolderPlus,
  X as XIcon,
  Tag as TagIcon,
  Users as UsersIcon,
  Calendar as CalendarIcon,
  Bookmark,
  Trash2,
  Layers,
  Settings2,
  LayoutGrid,
  CircleDot,
  CheckCircle2,
  SlidersHorizontal,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionHeading, SURFACE_CARD_INTERACTIVE } from "@/components/ui/surface";
import { PageTabStrip } from "@/components/PageTabStrip";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { TagPillRow, TagPill } from "@/features/photos/components/TagPill";
import { LabelChip } from "@/features/photos/components/LabelPicker";
import { useLabelCatalog, loadLabels, getCachedLabels } from "@/hooks/use-label-catalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { supabase } from "@/integrations/sitepix/client";
import { getMyTeam } from "@/lib/teams.functions";
import { MobileAppBanner } from "@/components/MobileAppBanner";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { listProjectGroups } from "@/features/projects/api";
import { listProjectBoards, type ProjectBoard } from "@/features/projects/api";
import { GroupCard } from "@/features/projects/components/GroupCard";
import {
  CreateGroupDialog,
  type ProjectPickerRow,
} from "@/features/projects/components/CreateGroupDialog";
import { CreateBoardDialog } from "@/features/projects/components/CreateBoardDialog";
import { TagBoardDetailView } from "@/features/projects/components/TagBoardDetailView";
import { BoardSettingsSheet } from "@/features/projects/components/BoardSettingsSheet";

/** Panes of the single Filters popover. */
const FILTER_PANES = [
  { key: "views", label: "Views", icon: Eye },
  { key: "tags", label: "Tags", icon: TagIcon },
  { key: "labels", label: "Labels", icon: Bookmark },
  { key: "people", label: "People", icon: UsersIcon },
  { key: "date", label: "Date", icon: CalendarIcon },
] as const;
type FilterPaneKey = (typeof FILTER_PANES)[number]["key"];

const DEFAULT_LABELS: Array<{ name: string; color: string }> = [
  { name: "Lead", color: "#3b82f6" },
  { name: "Proposal Sent", color: "#8b5cf6" },
  { name: "Scheduled", color: "#06b6d4" },
  { name: "In Progress", color: "#f59e0b" },
  { name: "Complete", color: "#10b981" },
  { name: "Unqualified", color: "#64748b" },
  { name: "On Hold", color: "#eab308" },
  { name: "Follow-up Needed", color: "#ef4444" },
];

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
  status: string;
  updated_at: string;
  created_at: string;
  created_by?: string | null;
  starred?: boolean | null;
  archived?: boolean | null;
  labels?: string[] | null;
  completed_at?: string | null;
}

/**
 * Tabs are destinations, not refinements.
 *
 * This run used to be All / Active / Completed / Starred / Archived / Groups /
 * Pipelines - seven pills of two different kinds. Starred and Archived went
 * first: they are refinements of whichever list you are already looking at
 * ("starred, active projects" was unreachable while they were mutually
 * exclusive tabs), so they became toggles in the Filters popover. Active and
 * Completed are the same species - predicates over the one projects array - so
 * they followed, onto the hero stats rail (one click) and the Filters popover
 * (discoverable). What is left is the three things that are genuinely
 * different content: the project list, saved Groups, and Pipelines.
 */
type TabKey = "projects" | "groups" | "boards";

/** Status is a refinement of the project list, reachable from the hero stats and the Filters popover. */
type StatusFilter = "any" | "active" | "completed";

/** hide = the default list; include = widen with archived; only = the archive itself. */
type ArchivedMode = "hide" | "include" | "only";

interface TagRow {
  id: string;
  name: string;
  color: string;
}

function projectLocation(p: ProjectRow): string | null {
  if (p.location && p.location.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x): x is string => !!x && x.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

const STATUS_BADGE: Record<string, { label: string; badgeClass: string }> = {
  active: { label: "Active", badgeClass: "bg-emerald-500" },
  on_hold: { label: "On hold", badgeClass: "bg-amber-500" },
  completed: { label: "Completed", badgeClass: "bg-[#101929]/85" },
};
const statusBadge = (s: string) => STATUS_BADGE[s] ?? STATUS_BADGE.active;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { guard } = useSubscriptionGate();
  const routeSearch = useSearch({ strict: false }) as { q?: string };
  const [allProjects, setAllProjects] = useState<ProjectRow[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [coverPaths, setCoverPaths] = useState<Record<string, string>>({});
  const [coverThumbPaths, setCoverThumbPaths] = useState<Record<string, string>>({});
  const [sampleUrls, setSampleUrls] = useState<Record<string, string[]>>({});
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const [checklistCounts, setChecklistCounts] = useState<Record<string, number>>({});
  const [recentMembers, setRecentMembers] = useState<
    Record<string, Array<{ id: string; name: string | null; avatar: string | null }>>
  >({});
  const [projectTagMap, setProjectTagMap] = useState<Record<string, TagRow[]>>({});
  const [allTags, setAllTags] = useState<TagRow[]>([]);

  // Tab + search state
  const [tab, setTab] = useState<TabKey>("projects");
  const [query, setQuery] = useState(routeSearch.q ?? "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("any");

  // Project label filter (color-managed labels stored on projects.labels[])
  const labelCatalog = useLabelCatalog();
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [labelMode, setLabelMode] = useState<"OR" | "AND">("OR");

  // Contributor filter (based on photo uploaders + project creator)
  const [selectedContributors, setSelectedContributors] = useState<string[]>([]);

  // Date range: uses created_at (Start) + completed_at (End) semantics.
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Ex-tabs, now refinements that compose with whatever view is selected.
  const [starredOnly, setStarredOnly] = useState(false);
  /**
   * Archived is three-state, not a checkbox.
   *
   * "include" is the old widening toggle - it lets an archived project still be
   * found under Active or Completed, which a separate Archived tab never could.
   * But the hero stat rail needs "only": every stat there is a number you can
   * click, and a button reading "12 archived" that makes the list *grow* by 12
   * is a different gesture wearing the same clothes as the three beside it.
   */
  const [archivedMode, setArchivedMode] = useState<ArchivedMode>("hide");

  /**
   * Refinement lives behind one control now.
   *
   * Tags, Labels, Assignees and Date each used to be their own 46px-tall button
   * beside the search box, so the toolbar read as five competing actions before
   * you had narrowed anything at all. They are panes of one "Filters" popover
   * instead - same filters, one button, one count badge telling you whether
   * anything is narrowing the list.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterPane, setFilterPane] = useState<FilterPaneKey>("views");

  // Groups
  const fetchGroups = listProjectGroups;
  const [groups, setGroups] = useState<
    Array<{
      id: string;
      name: string;
      description: string | null;
      project_count: number;
      thumbnails: string[];
      updated_at: string;
    }>
  >([]);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

  // Tag Boards - team-shared, auto-updating (any project matching the
  // board's tag_ids), distinct from the manual per-user Groups above.
  const fetchBoards = listProjectBoards;
  const [boards, setBoards] = useState<ProjectBoard[]>([]);
  const [createBoardOpen, setCreateBoardOpen] = useState(false);
  const [manageBoardOpen, setManageBoardOpen] = useState(false);
  const [activeBoard, setActiveBoard] = useState<ProjectBoard | null>(null);

  const seedDefaultLabelsIfNeeded = async () => {
    if (!user) return;
    await loadLabels(true);
    if (getCachedLabels().length > 0) return;
    // First-time visit: create the 8 suggested labels for this user.
    await Promise.all(
      DEFAULT_LABELS.map((l) =>
        (supabase as any)
          .from("labels")
          .insert({ name: l.name, color: l.color, team_id: null, created_by: user.id })
          .then(
            () => null,
            () => null,
          ),
      ),
    );
    await loadLabels(true);
  };

  interface ProjectsSnapshot {
    projects: ProjectRow[];
    projectTagMap: Record<string, TagRow[]>;
    allTags: TagRow[];
    coverUrls: Record<string, string>;
    coverPaths: Record<string, string>;
    coverThumbPaths: Record<string, string>;
    sampleUrls: Record<string, string[]>;
    photoCounts: Record<string, number>;
    reportCounts: Record<string, number>;
    checklistCounts: Record<string, number>;
    recentMembers: Record<
      string,
      Array<{ id: string; name: string | null; avatar: string | null }>
    >;
  }

  const load = async (): Promise<ProjectsSnapshot> => {
    if (!user) {
      return {
        projects: [],
        projectTagMap: {},
        allTags: [],
        coverUrls: {},
        coverPaths: {},
        coverThumbPaths: {},
        sampleUrls: {},
        photoCounts: {},
        reportCounts: {},
        checklistCounts: {},
        recentMembers: {},
      };
    }
    void seedDefaultLabelsIfNeeded();
    const [
      { data: projectList, error: projectError },
      { data: projectTagsJoin },
      { data: tagsList },
    ] = await Promise.all([
      (supabase as any)
        .from("projects")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      (supabase as any).from("project_tags").select("project_id, tag:tags(id, name, color)"),
      (supabase as any).from("tags").select("id, name, color").order("name", { ascending: true }),
    ]);
    if (projectError) toast.error(projectError.message);

    const projects = (projectList as ProjectRow[]) ?? [];
    const ptMap: Record<string, TagRow[]> = {};
    ((projectTagsJoin as Array<{ project_id: string; tag: TagRow | null }>) ?? []).forEach(
      (row) => {
        if (!row.tag) return;
        (ptMap[row.project_id] ??= []).push(row.tag);
      },
    );

    const allTagsList = (tagsList as TagRow[]) ?? [];

    if (projects.length) {
      const ids = projects.map((p) => p.id);

      // These three queries are independent of each other - run them as one
      // round-trip instead of three sequential ones.
      const [{ data: ph }, { data: rep }, { data: cl }] = await Promise.all([
        supabase
          .from("photos")
          .select("project_id, storage_path, thumb_path, image_url, uploaded_by, created_at")
          .in("project_id", ids)
          .order("created_at", { ascending: false }),
        (supabase as any).from("project_reports").select("project_id").in("project_id", ids),
        (supabase as any).from("project_checklists").select("project_id").in("project_id", ids),
      ]);
      const samplesByProject: Record<
        string,
        Array<{ storage_path: string; thumb_path: string | null; image_url: string | null }>
      > = {};
      const uploadersByProject: Record<string, string[]> = {};
      const counts: Record<string, number> = {};
      (
        (ph as Array<{
          project_id: string;
          storage_path: string;
          thumb_path: string | null;
          image_url: string | null;
          uploaded_by: string | null;
        }>) ?? []
      ).forEach((row) => {
        counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
        const arr = (samplesByProject[row.project_id] ??= []);
        if (arr.length < 4)
          arr.push({
            storage_path: row.storage_path,
            thumb_path: row.thumb_path ?? null,
            image_url: row.image_url,
          });
        if (row.uploaded_by) {
          const ups = (uploadersByProject[row.project_id] ??= []);
          if (!ups.includes(row.uploaded_by) && ups.length < 4) ups.push(row.uploaded_by);
        }
      });

      const pathsToSign: string[] = [];
      const signOwner: Array<{ pid: string; idx: number }> = [];
      const cover: Record<string, string> = {};
      // Storage paths for the covers, so the card can request a thumbnail
      // rather than downloading a full-res photo per project tile.
      const coverPaths: Record<string, string> = {};
      const coverThumbPaths: Record<string, string> = {};
      const samples: Record<string, string[]> = {};
      Object.entries(samplesByProject).forEach(([pid, list]) => {
        samples[pid] = list.map(() => "");
        list.forEach((f, i) => {
          if (i === 0 && f.storage_path) {
            coverPaths[pid] = f.storage_path;
            if (f.thumb_path) coverThumbPaths[pid] = f.thumb_path;
          }
          if (f.image_url) {
            samples[pid][i] = f.image_url;
            if (i === 0) cover[pid] = f.image_url;
          } else {
            pathsToSign.push(f.storage_path);
            signOwner.push({ pid, idx: i });
          }
        });
      });

      const rc: Record<string, number> = {};
      ((rep as Array<{ project_id: string }>) ?? []).forEach((r) => {
        rc[r.project_id] = (rc[r.project_id] ?? 0) + 1;
      });

      const cc: Record<string, number> = {};
      ((cl as Array<{ project_id: string }>) ?? []).forEach((r) => {
        cc[r.project_id] = (cc[r.project_id] ?? 0) + 1;
      });

      const uploaderIds = Array.from(new Set(Object.values(uploadersByProject).flat()));

      // These two depend on different results from the wave above, but not on
      // each other - sign cover/sample paths and look up uploader profiles in
      // one round-trip instead of two.
      /*
       * Uploader names/avatars come from the team RPC, not from `profiles`.
       *
       * This used to be `.from("profiles").select(...).in("id", uploaderIds)`
       * from the browser, and `profiles` lets you read only your OWN row - so
       * the map held exactly one entry and every other uploader fell through to
       * the `{ name: null, avatar: null }` default below. On screen that was
       * your avatar plus a row of identical "?" bubbles, and a contributor
       * filter listing "Unknown" once per teammate.
       */
      const [signedCovers, teamRes] = await Promise.all([
        pathsToSign.length
          ? supabase.storage.from("site-photos").createSignedUrls(pathsToSign, 60 * 60)
          : Promise.resolve({ data: null }),
        uploaderIds.length ? getMyTeam().catch(() => null) : Promise.resolve(null),
      ]);

      signedCovers.data?.forEach((s, i) => {
        if (!s.signedUrl) return;
        const { pid, idx } = signOwner[i];
        samples[pid][idx] = s.signedUrl;
        if (idx === 0) cover[pid] = s.signedUrl;
      });

      const profileMap: Record<string, { id: string; name: string | null; avatar: string | null }> =
        {};
      ((teamRes as any)?.members ?? []).forEach((m: any) => {
        profileMap[m.user_id] = {
          id: m.user_id,
          name: m.profile?.full_name ?? null,
          avatar: m.profile?.avatar_url ?? null,
        };
      });
      const membersByProject: Record<
        string,
        Array<{ id: string; name: string | null; avatar: string | null }>
      > = {};
      Object.entries(uploadersByProject).forEach(([pid, uids]) => {
        membersByProject[pid] = uids.map(
          (uid) => profileMap[uid] ?? { id: uid, name: null, avatar: null },
        );
      });

      return {
        projects,
        projectTagMap: ptMap,
        allTags: allTagsList,
        coverUrls: cover,
        coverPaths,
        coverThumbPaths,
        sampleUrls: samples,
        photoCounts: counts,
        reportCounts: rc,
        checklistCounts: cc,
        recentMembers: membersByProject,
      };
    }

    return {
      projects,
      projectTagMap: ptMap,
      allTags: allTagsList,
      coverUrls: {},
      coverPaths: {},
      coverThumbPaths: {},
      sampleUrls: {},
      photoCounts: {},
      reportCounts: {},
      checklistCounts: {},
      recentMembers: {},
    };
  };

  const loadGroups = async () => {
    try {
      const res = (await fetchGroups()) as any;
      return (res.groups ?? []) as Array<{
        id: string;
        name: string;
        description: string | null;
        project_count: number;
        thumbnails: string[];
        updated_at: string;
      }>;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load groups");
      return [];
    }
  };

  const loadBoards = async () => {
    try {
      const res = await fetchBoards();
      return res.boards;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load pipelines");
      return [];
    }
  };

  const qc = useQueryClient();
  // These two useQuery calls are purely a scheduling gate - "do I actually
  // need to run load()/loadGroups() again, or is cached-and-fresh good
  // enough". A useEffect synced on each query's data (below) mirrors it into
  // local useState so a cache-hit remount (queryFn skipped) still
  // repopulates the page instead of rendering the useState initial (empty)
  // values.
  const projectsQuery = useQuery({
    queryKey: qk.projectsList(user?.id ?? ""),
    queryFn: load,
    enabled: !!user,
    staleTime: 60_000,
  });
  const groupsQuery = useQuery({
    queryKey: qk.projectGroups(user?.id ?? ""),
    queryFn: loadGroups,
    enabled: !!user,
    staleTime: 60_000,
  });
  const boardsQuery = useQuery({
    queryKey: qk.projectBoards(user?.id ?? ""),
    queryFn: loadBoards,
    enabled: !!user,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!projectsQuery.data) return;
    setAllProjects(projectsQuery.data.projects);
    setProjectTagMap(projectsQuery.data.projectTagMap);
    setAllTags(projectsQuery.data.allTags);
    setCoverUrls(projectsQuery.data.coverUrls);
    setCoverPaths(projectsQuery.data.coverPaths);
    setCoverThumbPaths(projectsQuery.data.coverThumbPaths);
    setSampleUrls(projectsQuery.data.sampleUrls);
    setPhotoCounts(projectsQuery.data.photoCounts);
    setReportCounts(projectsQuery.data.reportCounts);
    setChecklistCounts(projectsQuery.data.checklistCounts);
    setRecentMembers(projectsQuery.data.recentMembers);
  }, [projectsQuery.data]);

  useEffect(() => {
    if (groupsQuery.data) setGroups(groupsQuery.data);
  }, [groupsQuery.data]);

  useEffect(() => {
    if (boardsQuery.data) setBoards(boardsQuery.data);
  }, [boardsQuery.data]);

  // Boards are tabs now, so one is always selected - keep the pointer valid as
  // boards are created/renamed/deleted.
  useEffect(() => {
    if (boards.length === 0) {
      setActiveBoard(null);
      return;
    }
    setActiveBoard((current) => {
      if (!current) return boards[0];
      return boards.find((b) => b.id === current.id) ?? boards[0];
    });
  }, [boards]);

  const loading = projectsQuery.isPending;
  const groupsLoading = groupsQuery.isPending;
  const boardsLoading = boardsQuery.isPending;

  const { pull, refreshing, indicatorStyle, progress } = usePullToRefresh({
    onRefresh: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: qk.projectsList(user?.id ?? "") }),
        qc.invalidateQueries({ queryKey: qk.projectGroups(user?.id ?? "") }),
      ]);
    },
  });

  // Aggregate contributor options from photo uploaders + project creators.
  const contributorOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string | null; avatar: string | null }>();
    Object.values(recentMembers).forEach((list) => {
      list.forEach((m) => {
        if (!map.has(m.id)) map.set(m.id, m);
      });
    });
    return Array.from(map.values()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [recentMembers]);

  const filteredProjects = useMemo(() => {
    let list = allProjects;
    // "include" widens the list rather than replacing it, so an archived project
    // can still be found under Active/Completed - the old Archived tab was a
    // separate world you had to leave your view to visit. "only" is that world,
    // for when you deliberately went looking for it.
    if (archivedMode === "hide") list = list.filter((p) => !p.archived);
    else if (archivedMode === "only") list = list.filter((p) => p.archived);
    if (starredOnly) list = list.filter((p) => p.starred);
    if (statusFilter !== "any") list = list.filter((p) => p.status === statusFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        if (p.name.toLowerCase().includes(q)) return true;
        const loc = projectLocation(p)?.toLowerCase() ?? "";
        if (loc.includes(q)) return true;
        const tags = projectTagMap[p.id] ?? [];
        if (tags.some((t) => t.name.toLowerCase().includes(q))) return true;
        const labels = p.labels ?? [];
        if (labels.some((l) => l.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    if (selectedTagIds.length > 0) {
      list = list.filter((p) => {
        const tagIds = new Set((projectTagMap[p.id] ?? []).map((t) => t.id));
        return selectedTagIds.every((id) => tagIds.has(id));
      });
    }
    if (selectedLabels.length > 0) {
      const wanted = selectedLabels.map((s) => s.toLowerCase());
      list = list.filter((p) => {
        const labels = (p.labels ?? []).map((l) => l.toLowerCase());
        return labelMode === "AND"
          ? wanted.every((w) => labels.includes(w))
          : wanted.some((w) => labels.includes(w));
      });
    }
    if (selectedContributors.length > 0) {
      list = list.filter((p) => {
        const contribs = new Set((recentMembers[p.id] ?? []).map((m) => m.id));
        if (p.created_by) contribs.add(p.created_by);
        return selectedContributors.some((id) => contribs.has(id));
      });
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((p) => new Date(p.created_at).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86_399_000; // inclusive end-of-day
      list = list.filter((p) => {
        // End = completed_at if set, else updated_at (project still open).
        const end = p.completed_at
          ? new Date(p.completed_at).getTime()
          : new Date(p.updated_at).getTime();
        return end <= to;
      });
    }
    return list;
  }, [
    allProjects,
    projectTagMap,
    statusFilter,
    query,
    selectedTagIds,
    selectedLabels,
    labelMode,
    selectedContributors,
    recentMembers,
    dateFrom,
    dateTo,
    starredOnly,
    archivedMode,
  ]);

  const projectPickerRows: ProjectPickerRow[] = useMemo(
    () =>
      allProjects
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id, name: p.name, location: projectLocation(p) })),
    [allProjects],
  );

  const updateStatus = async (id: string, status: string) => {
    const prev = allProjects;
    setAllProjects((ps) => ps.map((p) => (p.id === id ? { ...p, status } : p)));
    const { error } = await supabase.from("projects").update({ status }).eq("id", id);
    if (error) {
      setAllProjects(prev);
      toast.error(error.message);
    }
  };
  const toggleStar = async (id: string, next: boolean) => {
    const prev = allProjects;
    setAllProjects((ps) => ps.map((p) => (p.id === id ? { ...p, starred: next } : p)));
    const { error } = await (supabase as any)
      .from("projects")
      .update({ starred: next })
      .eq("id", id);
    if (error) {
      setAllProjects(prev);
      toast.error(error.message);
    }
  };
  const toggleArchive = async (id: string, next: boolean) => {
    const prev = allProjects;
    setAllProjects((ps) => ps.map((p) => (p.id === id ? { ...p, archived: next } : p)));
    const { error } = await (supabase as any)
      .from("projects")
      .update({ archived: next })
      .eq("id", id);
    if (error) {
      setAllProjects(prev);
      toast.error(error.message);
    } else toast.success(next ? "Project archived" : "Project restored");
  };

  const activeCount = allProjects.filter((p) => !p.archived).length;
  const activeStatusCount = allProjects.filter((p) => !p.archived && p.status === "active").length;
  const completedCount = allProjects.filter((p) => !p.archived && p.status === "completed").length;
  const starredCount = allProjects.filter((p) => p.starred && !p.archived).length;
  const archivedCount = allProjects.filter((p) => p.archived).length;

  // Three destinations, one per kind of thing. Every pill carries an icon so
  // the run reads as one navigation control - the same strip, now literally the
  // same component, that the project home page uses.
  const tabs = [
    { key: "projects", label: "Projects", count: activeCount, icon: LayoutGrid },
    { key: "groups", label: "Groups", count: groups.length, icon: FolderPlus },
    // Key stays "boards" (route/state/table naming); only the label is
    // user-facing, and "Pipeline" describes what the columns actually are.
    { key: "boards", label: "Pipelines", count: boards.length, icon: Layers },
  ];

  /**
   * Status stats double as the status filter.
   *
   * These four numbers used to be tab labels. Reading the workload and cutting
   * to it are the same gesture, so the number *is* the control - click "19
   * active" to see the 19. That is what the pipeline view does well, and it is
   * why Active/Completed could leave the tab strip without going two clicks deep.
   */
  const heroStats = [
    {
      key: "active",
      icon: CircleDot,
      count: activeStatusCount,
      label: "active",
      on: statusFilter === "active",
      toggle: () => setStatusFilter((s) => (s === "active" ? "any" : "active")),
    },
    {
      key: "completed",
      icon: CheckCircle2,
      count: completedCount,
      label: "completed",
      on: statusFilter === "completed",
      toggle: () => setStatusFilter((s) => (s === "completed" ? "any" : "completed")),
    },
    {
      key: "starred",
      icon: Star,
      count: starredCount,
      label: "starred",
      on: starredOnly,
      toggle: () => setStarredOnly((s) => !s),
    },
    {
      key: "archived",
      icon: Archive,
      count: archivedCount,
      label: "archived",
      on: archivedMode === "only",
      toggle: () => setArchivedMode((m) => (m === "only" ? "hide" : "only")),
    },
  ];

  /** Refinements behind the Filters button. Search is counted separately. */
  const filterCount =
    selectedTagIds.length +
    selectedLabels.length +
    selectedContributors.length +
    (dateFrom || dateTo ? 1 : 0) +
    (statusFilter !== "any" ? 1 : 0) +
    (starredOnly ? 1 : 0) +
    (archivedMode !== "hide" ? 1 : 0);
  const hasActiveFilters = !!query.trim() || filterCount > 0;

  /** Clears the popover's refinements. Does not touch the search keyword. */
  const clearRefinements = () => {
    setSelectedTagIds([]);
    setSelectedLabels([]);
    setSelectedContributors([]);
    setDateFrom("");
    setDateTo("");
    setStatusFilter("any");
    setStarredOnly(false);
    setArchivedMode("hide");
  };

  const clearAllFilters = () => {
    setQuery("");
    clearRefinements();
  };

  const bodyLabel =
    tab === "groups"
      ? "Groups"
      : tab === "boards"
        ? activeBoard
          ? activeBoard.name
          : "Pipelines"
        : archivedMode === "only"
          ? "Archived projects"
          : statusFilter === "active"
            ? "Active projects"
            : statusFilter === "completed"
              ? "Completed projects"
              : starredOnly
                ? "Starred projects"
                : "All projects";
  const bodyShownCount = tab === "groups" ? groups.length : filteredProjects.length;
  const bodyDescription =
    tab === "groups"
      ? `${bodyShownCount} ${bodyShownCount === 1 ? "group" : "groups"} - related projects sharing photos, stats and views.`
      : `${bodyShownCount} ${bodyShownCount === 1 ? "project" : "projects"} shown, most recently updated first.`;

  /**
   * The toolbar is not a band of its own any more - these two render into the
   * section header's action slot, the way the project home page puts its
   * controls on the same line as the heading they act on.
   */
  const searchInput = (
    <div className="relative w-full sm:w-60 md:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tab === "groups" ? "Search groups…" : "Search projects by name or address…"}
        className="h-8 rounded-lg border-border bg-card/80 pl-8 pr-8 text-xs shadow-none placeholder:text-muted-foreground"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Clear search"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  const filtersPopover = (
    <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {filterCount > 0 && (
            <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
              {filterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="end">
        <div className="flex items-center gap-0.5 border-b border-border p-1.5">
          {FILTER_PANES.map((p) => {
            const paneActive = filterPane === p.key;
            const n =
              p.key === "views"
                ? (statusFilter !== "any" ? 1 : 0) +
                  (starredOnly ? 1 : 0) +
                  (archivedMode !== "hide" ? 1 : 0)
                : p.key === "tags"
                  ? selectedTagIds.length
                  : p.key === "labels"
                    ? selectedLabels.length
                    : p.key === "people"
                      ? selectedContributors.length
                      : dateFrom || dateTo
                        ? 1
                        : 0;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setFilterPane(p.key)}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-bold transition ${
                  paneActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <p.icon className="h-3.5 w-3.5" />
                <span className="flex items-center gap-1">
                  {p.label}
                  {n > 0 && (
                    <span className={paneActive ? "text-background/60" : "text-primary"}>{n}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {filterPane === "views" && (
          <div className="p-3">
            {/*
                  Status used to be three tabs. It is a predicate over the one
                  project list, same as Starred and Archived, so it lives with
                  them - reachable here, and one click away on the hero stats.
                */}
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Status
            </div>
            <div className="mb-3 inline-flex w-full overflow-hidden rounded-lg border border-border">
              {(
                [
                  { key: "any", label: "Any", count: activeCount },
                  { key: "active", label: "Active", count: activeStatusCount },
                  { key: "completed", label: "Completed", count: completedCount },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStatusFilter(s.key)}
                  className={`flex flex-1 items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold transition ${
                    statusFilter === s.key
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s.label}
                  <span
                    className={
                      statusFilter === s.key ? "text-background/60" : "text-muted-foreground"
                    }
                  >
                    {s.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Narrow the current view
            </div>
            <div className="space-y-0.5">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setStarredOnly((s) => !s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setStarredOnly((s) => !s);
                  }
                }}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition ${
                  starredOnly ? "bg-accent/70" : "hover:bg-muted"
                }`}
              >
                <Checkbox checked={starredOnly} />
                <Star className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Starred only</div>
                  <div className="text-[11px] text-muted-foreground">
                    Just the projects you&apos;ve starred
                  </div>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">{starredCount}</span>
              </div>

              {/*
                Three states, not a checkbox: "Include" widens the current view,
                "Only" is the archive on its own. The hero stat toggles Hide/Only,
                so the number you click is the number you get.
              */}
              <div className="rounded-md px-2 py-2">
                <div className="flex items-center gap-2.5">
                  <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">Archived projects</div>
                    <div className="text-[11px] text-muted-foreground">
                      Hidden by default, or shown alongside the rest
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">
                    {archivedCount}
                  </span>
                </div>
                <div className="mt-2 inline-flex w-full overflow-hidden rounded-lg border border-border">
                  {(
                    [
                      { key: "hide", label: "Hide" },
                      { key: "include", label: "Include" },
                      { key: "only", label: "Only" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setArchivedMode(m.key)}
                      className={`flex-1 px-2 py-1.5 text-[11px] font-semibold transition ${
                        archivedMode === m.key
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {filterPane === "tags" && (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Select tags
              </span>
              <span className="text-[10px] text-muted-foreground">
                {selectedTagIds.length} selected
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto pr-1">
              {allTags.length === 0 ? (
                <div className="px-1 py-3 text-xs text-muted-foreground">
                  No tags yet - create one on a project to filter by it here.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {allTags.map((t) => {
                    const checked = selectedTagIds.includes(t.id);
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedTagIds((prev) =>
                            prev.includes(t.id)
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id],
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedTagIds((prev) =>
                              prev.includes(t.id)
                                ? prev.filter((id) => id !== t.id)
                                : [...prev, t.id],
                            );
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition ${
                          checked ? "bg-accent/70" : "hover:bg-muted"
                        }`}
                      >
                        <Checkbox checked={checked} />
                        <TagPill name={t.name} size="sm" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {selectedTagIds.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTagIds([])}
                className="mt-2 w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Clear tag filters
              </button>
            )}
          </div>
        )}

        {filterPane === "labels" && (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Project labels
              </span>
              <div className="inline-flex overflow-hidden rounded-md border border-border text-[10px]">
                <button
                  type="button"
                  onClick={() => setLabelMode("OR")}
                  className={`px-2 py-0.5 font-semibold ${labelMode === "OR" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                >
                  OR
                </button>
                <button
                  type="button"
                  onClick={() => setLabelMode("AND")}
                  className={`px-2 py-0.5 font-semibold ${labelMode === "AND" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                >
                  AND
                </button>
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto pr-1">
              {labelCatalog.rows.length === 0 ? (
                <div className="px-1 py-3 text-xs text-muted-foreground">
                  No labels yet - they’ll appear here after your first visit.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {labelCatalog.rows.map((l) => {
                    const checked = selectedLabels.includes(l.name);
                    const toggle = () =>
                      setSelectedLabels((prev) =>
                        prev.includes(l.name)
                          ? prev.filter((x) => x !== l.name)
                          : [...prev, l.name],
                      );
                    return (
                      <div
                        key={l.id}
                        role="button"
                        tabIndex={0}
                        onClick={toggle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggle();
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition ${checked ? "bg-accent/70" : "hover:bg-muted"}`}
                      >
                        <Checkbox checked={checked} />
                        <LabelChip label={l.name} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {selectedLabels.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedLabels([])}
                className="mt-2 w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Clear label filters
              </button>
            )}
          </div>
        )}

        {filterPane === "people" && (
          <div className="p-3">
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Filter by contributor
            </div>
            <div className="max-h-60 overflow-y-auto pr-1">
              {contributorOptions.length === 0 ? (
                <div className="px-1 py-3 text-xs text-muted-foreground">
                  No contributors yet - upload photos to a project.
                </div>
              ) : (
                contributorOptions.map((c) => {
                  const checked = selectedContributors.includes(c.id);
                  const toggle = () =>
                    setSelectedContributors((prev) =>
                      prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                    );
                  return (
                    <div
                      key={c.id}
                      role="button"
                      tabIndex={0}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${checked ? "bg-accent/70" : "hover:bg-muted"}`}
                    >
                      <Checkbox checked={checked} />
                      <Avatar className="h-6 w-6">
                        {c.avatar ? <AvatarImage src={c.avatar} alt="" /> : null}
                        <AvatarFallback className="text-[9px]">
                          {(c.name ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm">{c.name ?? "Unknown"}</span>
                    </div>
                  );
                })
              )}
            </div>
            {selectedContributors.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedContributors([])}
                className="mt-2 w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                Clear contributor filters
              </button>
            )}
          </div>
        )}

        {filterPane === "date" && (
          <div className="p-3">
            <div className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Filter by date range
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  Start (created)
                </label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  End (completed)
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Start = when project was created. End = when marked <b>Complete</b> (falls back to
                last activity if still open).
              </p>
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Clear dates
                </button>
              )}
            </div>
          </div>
        )}

        {filterCount > 0 && (
          <div className="border-t border-border p-1.5">
            <button
              type="button"
              onClick={clearRefinements}
              className="w-full rounded-lg py-1.5 text-center text-xs font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Clear all filters
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="min-h-screen bg-background">
      <div
        style={{
          transform: `translateY(${Math.min(pull, 70) * 0.5}px)`,
          transition: refreshing || pull === 0 ? "transform 200ms ease" : undefined,
        }}
      >
        {(pull > 0 || refreshing) && (
          <div
            className="pointer-events-none fixed left-1/2 top-2 z-50 -translate-x-1/2"
            style={indicatorStyle}
          >
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md">
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
                style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
              />
              {refreshing
                ? "Refreshing…"
                : progress >= 1
                  ? "Release to refresh"
                  : "Pull to refresh"}
            </div>
          </div>
        )}

        <MobileAppBanner />

        {/* Same container as the project home page, so the content edge does not
            jump when you click through from this list into a project. */}
        <div className="container mx-auto px-3 pb-32 pt-4 sm:px-4 sm:pt-6 md:pt-10">
          {/* Hero - same shell, ornament, badge and stats rail as the project home page. */}
          <div className="relative overflow-hidden rounded-[32px] bg-sidebar">
            <div className="pointer-events-none absolute -right-24 -top-28 h-[288px] w-[288px] rounded-full border-[28px] border-sidebar-ring/20" />
            <div className="relative flex flex-col gap-7 p-6 sm:px-10 sm:py-9">
              <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-sidebar-ring px-3 py-1 text-[10px] font-extrabold uppercase tracking-[1.4px] text-sidebar-foreground">
                      Workspace library
                    </span>
                  </div>
                  <h1 className="font-display mt-3 truncate text-2xl font-bold leading-tight tracking-tight text-sidebar-foreground sm:text-3xl">
                    Projects
                  </h1>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    onClick={() =>
                      guard(
                        () => navigate({ to: "/projects/new" }),
                        "Subscribe to create new projects.",
                      )
                    }
                    className="h-10 rounded-lg bg-sidebar-foreground px-5 font-bold text-sidebar shadow-sm hover:bg-sidebar-foreground/90"
                  >
                    <Plus className="mr-2 h-4 w-4 text-sidebar-ring" /> Create project
                  </Button>
                  {/* Trash is a rare recovery action; it was sized as a peer of the
                      page's only primary action. Behind the same overflow trigger
                      the project home page uses. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="More project actions"
                        className="h-10 w-10 rounded-xl border-sidebar-foreground/15 bg-sidebar-foreground/10 text-sidebar-foreground hover:bg-sidebar-foreground/20 hover:text-sidebar-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem asChild>
                        <Link to="/projects/trash">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Project trash
                        </Link>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Stats rail - states the workload and cuts to it in the same click. */}
              <div className="flex flex-col gap-4 border-t border-sidebar-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-sidebar-foreground/45">
                    Workspace
                  </span>
                  <span className="text-xs font-bold text-sidebar-foreground">
                    {activeCount} {activeCount === 1 ? "project" : "projects"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-5 text-xs font-bold text-sidebar-foreground/60">
                  {heroStats.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={s.toggle}
                      aria-pressed={s.on}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md transition hover:text-sidebar-foreground",
                        s.on && "text-sidebar-foreground",
                      )}
                    >
                      <s.icon
                        className={cn(
                          "h-4 w-4 text-sidebar-ring",
                          s.key === "starred" && s.on && "fill-current",
                        )}
                      />
                      {s.count} {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Literally the same component the project home page uses, so the two
              strips can no longer drift apart. */}
          <PageTabStrip
            className="mt-3.5"
            items={tabs}
            value={tab}
            onChange={(key) => setTab(key as TabKey)}
          />

          {/*
            One header, and it is the toolbar.

            There used to be a full-width search/Filters band here, an
            "Active filters:" chip rail under it, a Recent activity rail under
            that, and then a second header that repeated the hero's own
            "Workspace library" eyebrow - five bands before the first project.
            The project home page states the section and puts the controls that
            act on it on the same line, so this does too.
          */}
          {tab !== "boards" && (
            <SectionHeading
              className="mt-8"
              eyebrow={tab === "groups" ? "Saved collections" : "Field records"}
              title={bodyLabel}
              description={bodyDescription}
              actions={
                <>
                  {searchInput}
                  {tab === "projects" && filtersPopover}
                </>
              }
            />
          )}
          {/* Projects / Groups / Pipelines */}
          <div>
            {/*
              No header on the Pipelines tab: the pipeline strip below already
              names the active pipeline, and the board view names it a third
              time. One title per screen - and it is why the search box and
              Filters button, which do not act on a board, disappear here.
            */}
            <div className={tab === "boards" ? "mt-8" : "mt-5"}>
              {tab === "groups" ? (
                <GroupsGrid
                  groups={groups}
                  loading={groupsLoading}
                  query={query}
                  onCreate={() => setCreateGroupOpen(true)}
                />
              ) : tab === "boards" ? (
                <div>
                  {/*
                    Pipeline strip - each pipeline is directly selectable, no
                    drill-in/back step. "Manage" sits on the same line rather
                    than in a second header block below it.
                  */}
                  <div className="mb-5 flex items-center gap-1 border-b border-border">
                    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {boards.map((b) => {
                        const isActive = activeBoard?.id === b.id;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setActiveBoard(b)}
                            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
                              isActive
                                ? "border-foreground text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {b.name}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setCreateBoardOpen(true)}
                        aria-label="Create pipeline"
                        className="-mb-px shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    {activeBoard && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mb-1 shrink-0 text-xs"
                        onClick={() => setManageBoardOpen(true)}
                      >
                        <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage
                      </Button>
                    )}
                  </div>

                  {boardsLoading ? null : activeBoard ? (
                    <TagBoardDetailView
                      board={activeBoard}
                      allTags={allTags}
                      allProjects={allProjects}
                      projectTagMap={projectTagMap}
                      coverUrls={coverUrls}
                      photoCounts={photoCounts}
                      reportCounts={reportCounts}
                      onManage={() => setManageBoardOpen(true)}
                      onTagAssigned={(projectId, tag) => {
                        setProjectTagMap((prev) => {
                          const existing = prev[projectId] ?? [];
                          if (existing.some((t) => t.id === tag.id)) return prev;
                          return { ...prev, [projectId]: [...existing, tag] };
                        });
                      }}
                      onTagMoved={(projectId, fromTagId, toTag) => {
                        setProjectTagMap((prev) => {
                          const without = (prev[projectId] ?? []).filter((t) => t.id !== fromTagId);
                          return {
                            ...prev,
                            [projectId]: without.some((t) => t.id === toTag.id)
                              ? without
                              : [...without, toTag],
                          };
                        });
                      }}
                    />
                  ) : (
                    <EmptyState
                      icon={Layers}
                      title="No pipelines yet"
                      description='A pipeline moves projects through stages by tag (e.g. "Lead", "Active", "Complete") - shared with your team and always up to date. Drag a card between stages to re-tag it.'
                      action={
                        <Button onClick={() => setCreateBoardOpen(true)}>
                          <Layers className="mr-2 h-4 w-4" /> New Pipeline
                        </Button>
                      }
                    />
                  )}
                </div>
              ) : (
                <ProjectsList
                  projects={filteredProjects}
                  loading={loading}
                  hasQueryOrFilter={hasActiveFilters}
                  onClearFilters={clearAllFilters}
                  projectTagMap={projectTagMap}
                  coverUrls={coverUrls}
                  coverPaths={coverPaths}
                  coverThumbPaths={coverThumbPaths}
                  photoCounts={photoCounts}
                  reportCounts={reportCounts}
                  checklistCounts={checklistCounts}
                  recentMembers={recentMembers}
                  onStar={toggleStar}
                  onArchive={toggleArchive}
                  onStatus={updateStatus}
                />
              )}
            </div>
          </div>

          {activeBoard && (
            <BoardSettingsSheet
              open={manageBoardOpen}
              onOpenChange={setManageBoardOpen}
              allTags={allTags}
              board={activeBoard}
              onUpdated={(updated) => {
                setBoards((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
                setActiveBoard(updated);
              }}
              onDeleted={(id) => {
                setBoards((prev) => prev.filter((b) => b.id !== id));
                setActiveBoard(null);
              }}
            />
          )}

          <CreateBoardDialog
            open={createBoardOpen}
            onOpenChange={setCreateBoardOpen}
            allTags={allTags}
            onCreated={(board) => {
              setBoards((prev) => [board, ...prev]);
              void qc.invalidateQueries({ queryKey: qk.projectBoards(user?.id ?? "") });
            }}
          />

          <CreateGroupDialog
            open={createGroupOpen}
            onOpenChange={setCreateGroupOpen}
            projects={projectPickerRows}
            onCreated={() => {
              void qc.invalidateQueries({ queryKey: qk.projectGroups(user?.id ?? "") });
              setTab("groups");
            }}
          />
        </div>
      </div>
    </div>
  );
}

function GroupsGrid({
  groups,
  loading,
  query,
  onCreate,
}: {
  groups: Array<{
    id: string;
    name: string;
    description: string | null;
    project_count: number;
    thumbnails: string[];
    updated_at: string;
  }>;
  loading: boolean;
  query: string;
  onCreate: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) => g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q),
    );
  }, [groups, query]);

  if (loading) {
    return null;
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={FolderPlus}
        title={query.trim() ? "No groups match your search" : "No project groups yet"}
        description={
          query.trim()
            ? "Try a different search term."
            : 'Group related projects (e.g. "Starbucks Locations") to see combined photos, stats, and shared views.'
        }
        action={
          !query.trim() ? (
            <Button onClick={onCreate}>
              <FolderPlus className="mr-2 h-4 w-4" /> New Group
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {filtered.map((g) => (
        <GroupCard
          key={g.id}
          id={g.id}
          name={g.name}
          description={g.description}
          projectCount={g.project_count}
          thumbnails={g.thumbnails}
        />
      ))}
    </div>
  );
}

function ProjectsList({
  projects,
  loading,
  hasQueryOrFilter,
  onClearFilters,
  coverUrls,
  coverPaths,
  coverThumbPaths,
  photoCounts,
  reportCounts,
  checklistCounts,
  recentMembers,
  projectTagMap,
  onStar,
  onArchive,
  onStatus,
}: {
  projects: ProjectRow[];
  loading: boolean;
  hasQueryOrFilter: boolean;
  onClearFilters: () => void;
  coverUrls: Record<string, string>;
  coverPaths: Record<string, string>;
  coverThumbPaths: Record<string, string>;
  photoCounts: Record<string, number>;
  reportCounts: Record<string, number>;
  checklistCounts: Record<string, number>;
  recentMembers: Record<string, Array<{ id: string; name: string | null; avatar: string | null }>>;
  projectTagMap: Record<string, TagRow[]>;
  onStar: (id: string, next: boolean) => void;
  onArchive: (id: string, next: boolean) => void;
  onStatus: (id: string, status: string) => void;
}) {
  if (loading) {
    return null;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={FolderKanban}
        title={hasQueryOrFilter ? "No projects match" : "No projects yet"}
        description={
          hasQueryOrFilter
            ? // Not "try another tab" - the other two tabs are Groups and
              // Pipelines, which show different things entirely. The only way
              // out of an empty list is to widen the search or drop a filter.
              "Try a different search term, or clear your filters to see everything again."
            : "Create your first project to start capturing photos."
        }
        action={
          hasQueryOrFilter ? (
            <Button variant="outline" onClick={onClearFilters}>
              <XIcon className="mr-2 h-4 w-4" /> Clear search and filters
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => {
        const badge = statusBadge(p.status);
        const cover = coverUrls[p.id];
        const photoCount = photoCounts[p.id] ?? 0;
        const reportCount = reportCounts[p.id] ?? 0;
        const checklistCount = checklistCounts[p.id] ?? 0;
        const members = recentMembers[p.id] ?? [];
        const loc = projectLocation(p);
        const tags = projectTagMap[p.id] ?? [];
        return (
          <div
            key={p.id}
            className={cn(SURFACE_CARD_INTERACTIVE, "group flex flex-col overflow-hidden")}
          >
            <Link
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="relative block h-40 w-full shrink-0 overflow-hidden bg-muted"
              aria-label={`Open ${p.name}`}
            >
              {cover || coverPaths[p.id] ? (
                <PhotoThumb
                  storagePath={coverPaths[p.id]}
                  thumbPath={coverThumbPaths[p.id]}
                  fallbackUrl={cover}
                  width={420}
                  alt={`${p.name} cover`}
                  className="transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                  <ImageOff className="h-6 w-6 opacity-60" />
                  <span className="text-[10px] uppercase tracking-wider">No photos</span>
                </div>
              )}
              <span
                className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full ${badge.badgeClass} px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                {badge.label}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onStar(p.id, !p.starred);
                }}
                aria-label={p.starred ? "Unstar project" : "Star project"}
                className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-sidebar/40 text-sidebar-foreground backdrop-blur transition hover:bg-sidebar/60"
              >
                <Star className={`h-4 w-4 ${p.starred ? "fill-amber-400 text-amber-400" : ""}`} />
              </button>
            </Link>

            <div className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    className="block truncate text-base font-extrabold tracking-tight text-foreground hover:text-primary"
                  >
                    {p.name}
                  </Link>
                  {loc && (
                    <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="truncate">{loc}</span>
                    </p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Set status
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      disabled={p.status === "active"}
                      onClick={() => onStatus(p.id, "active")}
                    >
                      <span className="mr-2 h-2 w-2 rounded-full bg-emerald-400" />
                      Active
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={p.status === "on_hold"}
                      onClick={() => onStatus(p.id, "on_hold")}
                    >
                      <span className="mr-2 h-2 w-2 rounded-full bg-amber-400" />
                      On hold
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={p.status === "completed"}
                      onClick={() => onStatus(p.id, "completed")}
                    >
                      <span className="mr-2 h-2 w-2 rounded-full bg-violet-400" />
                      Completed
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onStar(p.id, !p.starred)}>
                      <Star
                        className={`mr-2 h-4 w-4 ${p.starred ? "fill-amber-400 text-amber-400" : ""}`}
                      />
                      {p.starred ? "Unstar" : "Star"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onArchive(p.id, !p.archived)}>
                      {p.archived ? (
                        <>
                          <ArchiveRestore className="mr-2 h-4 w-4" />
                          Restore
                        </>
                      ) : (
                        <>
                          <Archive className="mr-2 h-4 w-4" />
                          Archive
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to="/projects/$projectId" params={{ projectId: p.id }}>
                        Open project
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {(p.labels ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {(p.labels ?? []).slice(0, 3).map((label) => (
                    <LabelChip key={label} label={label} />
                  ))}
                  {(p.labels ?? []).length > 3 && (
                    <span className="text-[10px] font-medium text-muted-foreground">
                      +{(p.labels ?? []).length - 3}
                    </span>
                  )}
                </div>
              )}
              {tags.length > 0 && <TagPillRow tags={tags.map((t) => t.name)} size="sm" max={4} />}

              {/*
                One meta band, not two. Counts, last activity and the crew used
                to sit in two stacked bordered rows, which cost a row of cards
                per screen to say the same thing.
              */}
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] font-semibold text-muted-foreground">
                  <span
                    className="inline-flex items-center gap-1.5"
                    title={`${photoCount} ${photoCount === 1 ? "photo" : "photos"}`}
                  >
                    <Camera className="h-3.5 w-3.5" />
                    {photoCount}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5"
                    title={`${reportCount} ${reportCount === 1 ? "report" : "reports"}`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {reportCount}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5"
                    title={`${checklistCount} ${checklistCount === 1 ? "checklist" : "checklists"}`}
                  >
                    <FolderKanban className="h-3.5 w-3.5" />
                    {checklistCount}
                  </span>
                  <span className="inline-flex items-center gap-1.5" title="Last activity">
                    <Clock className="h-3.5 w-3.5" />
                    {timeAgo(p.updated_at)}
                  </span>
                </div>
                {members.length > 0 && (
                  <div className="flex shrink-0 -space-x-1.5">
                    {members.slice(0, 4).map((m) => (
                      <Avatar key={m.id} className="h-6 w-6 border-2 border-card">
                        {m.avatar ? <AvatarImage src={m.avatar} alt={m.name ?? ""} /> : null}
                        <AvatarFallback className="bg-foreground text-[9px] font-extrabold text-background">
                          {(m.name ?? "?").slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
