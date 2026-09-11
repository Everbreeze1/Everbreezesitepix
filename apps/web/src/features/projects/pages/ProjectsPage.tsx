import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PROJECT_STATUS_LABELS, formatCalendarDate, type ProjectStatus } from "@everlumen/shared";
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
  CalendarClock,
  Trash2,
  Layers,
  Settings2,
  LayoutGrid,
  CircleDot,
  CheckCircle2,
  SlidersHorizontal,
  Eye,
  GitBranch,
  CircleSlash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REFERENCE_PAGE,
  REFERENCE_TITLE,
  REFERENCE_SUBTITLE,
  REFERENCE_CARD,
  ReferencePill,
  ReferenceTabStrip,
} from "@/components/ui/reference";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { supabase } from "@/integrations/everlumen/client";
import { getMyTeam } from "@/lib/teams.functions";
import { useTeamMembers, type TeamMemberLite } from "@/hooks/use-team-members";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { listProjectGroups } from "@/features/projects/api";
import {
  listProjectBoards,
  type PipelineStage,
  type ProjectBoard,
} from "@/features/projects/api";
import { GroupCard } from "@/features/projects/components/GroupCard";
import {
  CreateGroupDialog,
  type ProjectPickerRow,
} from "@/features/projects/components/CreateGroupDialog";
import { CreateBoardDialog } from "@/features/projects/components/CreateBoardDialog";
import { PipelineBoardView } from "@/features/projects/components/PipelineBoardView";
import { PipelineTabStrip } from "@/features/projects/components/PipelineTabStrip";
import { BoardSettingsSheet } from "@/features/projects/components/BoardSettingsSheet";
import { AssignTeammatesDialog } from "@/features/projects/components/AssignTeammatesDialog";
import { ProjectCrew } from "@/features/projects/components/ProjectCrew";
import { WorkspaceSchedule } from "@/features/projects/components/WorkspaceSchedule";
import { useProjectAssignees } from "@/hooks/use-project-assignees";
import { useWorkspaceSchedule } from "@/hooks/use-workspace-schedule";
import { attentionCount, type StageLite } from "@/lib/workspace-schedule";

/**
 * The stage filter's stand-in for NULL.
 *
 * "Show me what is not in a pipeline yet" is the question the whole unassigned
 * rail exists to answer, and it needs to be askable from the list too. A
 * sentinel keeps it in the same array as the real stage ids rather than paying
 * for a second piece of state.
 */
const NO_STAGE = "__none__";

/** Panes of the single Filters popover. */
const FILTER_PANES = [
  { key: "views", label: "Views", icon: Eye },
  { key: "stage", label: "Stage", icon: GitBranch },
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

/**
 * Black or white on a stage chip, whichever wins on WCAG contrast.
 *
 * Stage colours are chosen per board and span pale ambers to dark violets, so a
 * fixed foreground puts unreadable text on half of them. Same rule as the board
 * columns use, so a stage reads identically in both places.
 */
function stageChipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#111827" : "#ffffff";
}

/**
 * One tickable stage in the Filters popover.
 *
 * Carries its own count because the useful question is usually "how much work
 * is sitting at Invoiced", and a filter row that answers it before you tick it
 * saves the round trip.
 */
function StageFilterRow({
  checked,
  color,
  label,
  count,
  onToggle,
}: {
  checked: boolean;
  /** Absent on "Not in a pipeline", which is a state rather than a stage. */
  color?: string;
  label: string;
  count: number;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition ${
        checked ? "bg-accent/70" : "hover:bg-muted"
      }`}
    >
      <Checkbox checked={checked} />
      {color ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      ) : (
        <CircleSlash className="h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      <span className="shrink-0 text-[10px] font-bold text-muted-foreground">{count}</span>
    </div>
  );
}

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
  /**
   * The single-select pipeline position. Separate from `status`, which is the
   * big-picture Active/Completed/Archived bucket, and separate from tags, which
   * no longer double as stages. NULL means the project is in no pipeline.
   */
  pipeline_stage_id?: string | null;
  /**
   * The day this job is booked for, and the only thing that can put a project
   * on the Calendar tab's grid. Optional in the type rather than nullable
   * because the column arrives with
   * 20260923000000_project_scheduled_date.sql: until that is applied the key
   * is absent from the row entirely, which is how `supportsScheduledDate`
   * knows to hide the date controls instead of offering a write that can only
   * fail.
   */
  scheduled_date?: string | null;
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
 *
 * Schedule is the fourth of those, and it earns the slot on the same test. It
 * is not the project list sorted by a date: it is task due dates and booked
 * job days from every project on one grid, which no filter over `allProjects`
 * can produce. The client's report is the shape of the gap:
 *
 *   "With dozens of active projects, there's no single place to answer 'what's
 *    due today' or 'what's scheduled this week' without opening each project
 *    individually."
 *
 * ## Why it is not called Calendar
 *
 * It was, for one release, and the client caught it:
 *
 *   "This new workspace-level tab is currently called 'Calendar,' which
 *    collides with the existing per-project 'Calendar' tab (the historical
 *    photo capture log) - two different features with the same name will
 *    confuse users."
 *
 * They are right, and the collision was worse than a label clash: the two mean
 * opposite things. The per-project Calendar (`PhotoCalendar`) is a backwards
 * record of which days a crew shot photos on one job. This is forward-looking
 * and spans every job. One word cannot carry both, so this one took the name
 * it already used internally, and the per-project tab keeps Calendar. The
 * module behind it is named to match: apps/web/src/lib/workspace-schedule.ts.
 */
type TabKey = "projects" | "groups" | "boards" | "schedule";

/** What `/projects` accepts in its query string. Validated by the route. */
export type ProjectsIndexSearch = {
  q?: string;
  tab?: TabKey;
};

/** Status is a refinement of the project list, reachable from the hero stats and the Filters popover. */
type StatusFilter = "any" | "active" | "on_hold" | "completed";
type FilterPillKey = "all" | "active" | "on_hold" | "completed" | "archived";

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
  const routeSearch = useSearch({ strict: false }) as ProjectsIndexSearch;
  const [allProjects, setAllProjects] = useState<ProjectRow[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [coverPaths, setCoverPaths] = useState<Record<string, string>>({});
  const [coverThumbPaths, setCoverThumbPaths] = useState<Record<string, string>>({});
  const [sampleUrls, setSampleUrls] = useState<Record<string, string[]>>({});
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const [checklistCounts, setChecklistCounts] = useState<Record<string, number>>({});
  const [blueprintNames, setBlueprintNames] = useState<Record<string, string>>({});
  const [recentMembers, setRecentMembers] = useState<
    Record<string, Array<{ id: string; name: string | null; avatar: string | null }>>
  >({});
  const [projectTagMap, setProjectTagMap] = useState<Record<string, TagRow[]>>({});
  const [allTags, setAllTags] = useState<TagRow[]>([]);

  // Tab + search state. The tab opens where the URL says, so a Calendar link
  // lands on the Calendar rather than on the project list.
  const [tab, setTab] = useState<TabKey>(routeSearch.tab ?? "projects");
  const [query, setQuery] = useState(routeSearch.q ?? "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  /** Stage ids, plus NO_STAGE for "not in a pipeline". Empty means no filter. */
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
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
  const [archivedMode, setArchivedMode] = useState<ArchivedMode>("include");

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

  // Pipelines - team-shared boards whose columns are real stages the board
  // owns, with each project holding exactly one of them
  // (`projects.pipeline_stage_id`). Distinct from the manual per-user Groups
  // above, and no longer built out of tags.
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
    blueprintNames: Record<string, string>;
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
        blueprintNames: {},
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
        (supabase as any).from("project_reports").select("project_id, name, created_at").in("project_id", ids),
        (supabase as any).from("project_checklists").select("project_id, name, created_at").in("project_id", ids),
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

      const blueprintNames: Record<string, string> = {};
      const blueprintAt: Record<string, string> = {};
      const noteBlueprint = (pid: string, name: unknown, at: unknown) => {
        if (typeof name !== "string" || !name.trim()) return;
        const stamp = typeof at === "string" ? at : "";
        if (!(pid in blueprintNames) || stamp >= (blueprintAt[pid] ?? "")) {
          blueprintNames[pid] = name;
          blueprintAt[pid] = stamp;
        }
      };
      const rc: Record<string, number> = {};
      ((rep as Array<{ project_id: string; name?: string | null; created_at?: string }>) ?? []).forEach((r) => {
        rc[r.project_id] = (rc[r.project_id] ?? 0) + 1;
        noteBlueprint(r.project_id, r.name, r.created_at);
      });

      const cc: Record<string, number> = {};
      ((cl as Array<{ project_id: string; name?: string | null; created_at?: string }>) ?? []).forEach((r) => {
        cc[r.project_id] = (cc[r.project_id] ?? 0) + 1;
        noteBlueprint(r.project_id, r.name, r.created_at);
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
        blueprintNames,
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
    setBlueprintNames(projectsQuery.data.blueprintNames ?? {});
    setRecentMembers(projectsQuery.data.recentMembers);
  }, [projectsQuery.data]);

  useEffect(() => {
    if (groupsQuery.data) setGroups(groupsQuery.data);
  }, [groupsQuery.data]);

  useEffect(() => {
    if (boardsQuery.data) setBoards(boardsQuery.data);
  }, [boardsQuery.data]);

  /*
   * A pipeline that was only just created is not "missing", it is in flight.
   *
   * The effect below falls back to the first tab whenever the selected board is
   * absent from the list, which is right for a board somebody deleted and wrong
   * for one created a moment ago: `onCreated` selects it, then the refetch it
   * kicks off lands a list that does not have it yet, and the selection snaps
   * back to a different tab. That is what the client saw as the new pipeline
   * "hiding" - it really was created, and really was deselected again.
   */
  const justCreatedBoardId = useRef<string | null>(null);

  // Boards are tabs now, so one is always selected - keep the pointer valid as
  // boards are created/renamed/deleted.
  useEffect(() => {
    if (boards.length === 0) {
      setActiveBoard(null);
      return;
    }
    setActiveBoard((current) => {
      if (!current) return boards[0];
      const found = boards.find((b) => b.id === current.id);
      if (found) return found;
      /*
       * Hold the selection while the list catches up with the write.
       *
       * Deliberately not cleared the first time the board shows up. The local
       * `setBoards` puts it in the list immediately, so clearing on the first
       * match would drop the guard a moment before the refetch - which is the
       * one list that might not have it yet - lands and knocks the selection
       * onto another tab. The guard is released when a person picks a
       * different tab, which is the only point at which it could be wrong.
       */
      if (justCreatedBoardId.current === current.id) return current;
      return boards[0];
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

  /*
   * "include" widens the list rather than replacing it, so an archived project
   * can still be found under All - the old Archived tab was a
   * separate world you had to leave your view to visit. "only" is that world,
   * for when you deliberately went looking for it.
   *
   * "All" is include + no status (everything, like the mockup's All 62);
   * Active/On hold/Completed are hide + that status (open work only).
   */
  const filteredProjects = useMemo(() => {
    let list = allProjects;
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
    /*
     * OR, where tags are AND, and the difference is not a preference.
     *
     * A project carries many tags, so "Kitchen AND Urgent" narrows to the
     * projects holding both. A project holds one stage, so "Scheduled AND
     * Invoiced" would always be empty. Ticking two stages has to mean "either",
     * or the control is a trap.
     */
    if (selectedStageIds.length > 0) {
      list = list.filter((p) => selectedStageIds.includes(p.pipeline_stage_id ?? NO_STAGE));
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
    selectedStageIds,
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
  /**
   * The board's optimistic move, and its undo.
   *
   * The write itself lives in the board view (one RPC, one field). This moves
   * the local row, and with it the status: the stage owns the bucket now (see
   * packages/shared/src/pipeline-stages.ts), so a card dragged to "Paid" has to
   * lose its green Active badge in the same render, the way it does in the
   * database. Passing `null` for the stage leaves the status alone - a job
   * taken out of a pipeline keeps whatever it had counted as.
   */
  const setPipelineStageLocally = (projectId: string, stageId: string | null) => {
    const bucket = stageId ? stageLookup[stageId]?.status : undefined;
    setAllProjects((ps) =>
      ps.map((p) =>
        p.id === projectId
          ? {
              ...p,
              pipeline_stage_id: stageId,
              status: bucket && p.status !== "archived" ? bucket : p.status,
            }
          : p,
      ),
    );
  };

  /**
   * The same move the board's drag makes, from the project list.
   *
  /** Stage id to how it should be drawn, plus which pipeline it belongs to. */
  const stageLookup = useMemo(() => {
    const out: Record<
      string,
      { name: string; color: string; boardName: string; status: ProjectStatus }
    > = {};
    for (const b of boards) {
      for (const s of b.stages) {
        out[s.id] = { name: s.name, color: s.color, boardName: b.name, status: s.status };
      }
    }
    return out;
  }, [boards]);

  /** Every stage a project could be moved to, grouped by pipeline. */
  const stageOptions = useMemo(
    () =>
      boards
        .filter((b) => b.stages.length > 0)
        .map((b) => ({
          id: b.id,
          name: b.name,
          stages: [...b.stages].sort((x, y) => x.position - y.position),
        })),
    [boards],
  );

  /*
   * The Calendar tab's inputs.
   *
   * Both halves of it are already on this page: the projects (and with them
   * `scheduled_date`, which rides along on the `select("*")` above) and the
   * pipeline stages that say which column a job is standing in. Only the task
   * due dates are a new read, and that is one query for the whole workspace
   * rather than one per project. It runs whichever tab is open, because the
   * count on the tab is the answer to "what's due today" and a badge you have
   * to open the tab to see is not a badge.
   *
   * `stagesById` is a second, narrower shape of the same data as
   * `stageLookup`. Kept separate so the calendar module can be a plain
   * function over plain data, testable without a board or a React tree.
   */
  const stagesById = useMemo(() => {
    const m = new Map<string, StageLite>();
    for (const b of boards) {
      for (const s of b.stages) m.set(s.id, { id: s.id, name: s.name, color: s.color });
    }
    return m;
  }, [boards]);

  const {
    schedule,
    loading: scheduleLoading,
    error: scheduleError,
    refetch: refetchSchedule,
    canSchedule,
  } = useWorkspaceSchedule(allProjects, stagesById);

  /**
   * Book a job for a day, or take the day back off it.
   *
   * Optimistic like every other write on this page, and it also writes the
   * React Query snapshot rather than only the local array. The others get away
   * with local-only because nothing they change survives a refetch being
   * interesting; a date somebody just typed reverting under them when the
   * 60-second staleTime lapses is exactly the kind of thing that makes a
   * calendar untrustworthy.
   */
  const setScheduledDate = async (projectId: string, date: string | null) => {
    const previous = allProjects.find((p) => p.id === projectId)?.scheduled_date ?? null;
    if (previous === date) return;

    const apply = (value: string | null) => {
      setAllProjects((ps) =>
        ps.map((p) => (p.id === projectId ? { ...p, scheduled_date: value } : p)),
      );
      qc.setQueryData(qk.projectsList(user?.id ?? ""), (prev: ProjectsSnapshot | undefined) =>
        prev
          ? {
              ...prev,
              projects: prev.projects.map((p) =>
                p.id === projectId ? { ...p, scheduled_date: value } : p,
              ),
            }
          : prev,
      );
    };

    apply(date);
    const { error } = await (supabase as any)
      .from("projects")
      .update({ scheduled_date: date })
      .eq("id", projectId);
    if (error) {
      apply(previous);
      toast.error(error.message);
      return;
    }
    toast.success(date ? `Scheduled for ${formatCalendarDate(date)}` : "Date cleared");
  };

  /** How many projects each stage holds, so removing one can say what it costs. */
  const projectCountByStage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allProjects) {
      if (p.pipeline_stage_id) counts[p.pipeline_stage_id] = (counts[p.pipeline_stage_id] ?? 0) + 1;
    }
    return counts;
  }, [allProjects]);

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

  const activeCount = allProjects.filter((p) => !p.archived && p.status === "active").length;
  const onHoldCount = allProjects.filter((p) => !p.archived && p.status === "on_hold").length;
  const completedCount = allProjects.filter((p) => !p.archived && p.status === "completed").length;
  const archivedCount = allProjects.filter((p) => p.archived).length;
  const totalCount = allProjects.length;
  const starredCount = allProjects.filter((p) => p.starred && !p.archived).length;

  // Four destinations, one per kind of thing. Labels match the reference
  // mockup exactly (All Projects / Project Groups / Pipeline / Schedule).
  const tabs = [
    { key: "projects", label: "All Projects" },
    { key: "groups", label: "Project Groups" },
    // Key stays "boards" (route/state/table naming); only the label is
    // user-facing, and "Pipeline" describes what the columns actually are.
    { key: "boards", label: "Pipeline" },
    { key: "schedule", label: "Schedule" },
  ];

  /**
   * Status pills double as the status filter.
   *
   * Five pills matching the reference mockup: All (dark when selected) /
   * Active (green) / On hold (amber) / Completed (blue) / Archived (gray).
   * "All" and "Archived" drive archivedMode; the middle three are non-archived
   * projects of that status. This replaces heroStats (starred now lives in the
   * Filters popover only).
   */
  const activePill: FilterPillKey =
    archivedMode === "only"
      ? "archived"
      : archivedMode === "include"
        ? "all"
        : statusFilter === "any"
          ? "all"
          : statusFilter;
  const setPill = (pill: FilterPillKey) => {
    if (pill === "all") {
      setArchivedMode("include");
      setStatusFilter("any");
    } else if (pill === "archived") {
      setArchivedMode("only");
      setStatusFilter("any");
    } else {
      setArchivedMode("hide");
      setStatusFilter(pill);
    }
  };
  const filterPills: Array<{ key: FilterPillKey; label: string; count: number; toneClass: string }> = [
    { key: "all", label: "All", count: totalCount, toneClass: "text-foreground" },
    { key: "active", label: "Active", count: activeCount, toneClass: "text-status-active" },
    { key: "on_hold", label: "On hold", count: onHoldCount, toneClass: "text-status-hold" },
    {
      key: "completed",
      label: "Completed",
      count: completedCount,
      toneClass: "text-status-complete",
    },
    { key: "archived", label: "Archived", count: archivedCount, toneClass: "text-status-archived" },
  ];

  /** Refinements behind the Filters button. Search is counted separately. Pills are the default view, not a refinement. */
  const filterCount =
    selectedTagIds.length +
    selectedStageIds.length +
    selectedLabels.length +
    selectedContributors.length +
    (dateFrom || dateTo ? 1 : 0) +
    (starredOnly ? 1 : 0);
  const hasActiveFilters = !!query.trim() || filterCount > 0;

  /** Clears the popover's refinements. Does not touch the search keyword or the status pills. */
  const clearRefinements = () => {
    setSelectedTagIds([]);
    setSelectedStageIds([]);
    setSelectedLabels([]);
    setSelectedContributors([]);
    setDateFrom("");
    setDateTo("");
    setStarredOnly(false);
  };

  const clearAllFilters = () => {
    setQuery("");
    clearRefinements();
    setPill("all");
  };

  const subtitleText =
    tab === "groups"
      ? `${groups.length} ${groups.length === 1 ? "group" : "groups"}`
      : tab === "boards"
        ? activeBoard
          ? activeBoard.name
          : "Pipelines"
        : tab === "schedule"
          ? "Upcoming work and due dates"
          : `${activeCount} active out of ${totalCount} total`;
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
            : statusFilter === "on_hold"
              ? "Projects on hold"
              : statusFilter === "completed"
                ? "Completed projects"
                : starredOnly
                  ? "Starred projects"
                  : "All projects";
  const bodyShownCount = tab === "groups" ? groups.length : filteredProjects.length;

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
        placeholder={tab === "groups" ? "Search groupsÃ¢â‚¬Â¦" : "Search projects by name or addressÃ¢â‚¬Â¦"}
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
                : p.key === "stage"
                  ? selectedStageIds.length
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

        {filterPane === "stage" && (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Pipeline stage
              </span>
              <span className="text-[10px] text-muted-foreground">
                {selectedStageIds.length} selected
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto pr-1">
              {stageOptions.length === 0 ? (
                <div className="px-1 py-3 text-xs text-muted-foreground">
                  No pipelines yet. Build one on the Pipelines tab and every project can hold a
                  stage.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {stageOptions.map((b) => (
                    <div key={b.id}>
                      <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {b.name}
                      </p>
                      {b.stages.map((s) => (
                        <StageFilterRow
                          key={s.id}
                          checked={selectedStageIds.includes(s.id)}
                          color={s.color}
                          label={s.name}
                          count={projectCountByStage[s.id] ?? 0}
                          onToggle={() =>
                            setSelectedStageIds((prev) =>
                              prev.includes(s.id)
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id],
                            )
                          }
                        />
                      ))}
                    </div>
                  ))}
                  {/*
                    The list's half of the unassigned rail. Same question, asked
                    from the other view: what has not been placed yet.
                  */}
                  <div className="mt-2 border-t border-border pt-2">
                    <StageFilterRow
                      checked={selectedStageIds.includes(NO_STAGE)}
                      label="Not in a pipeline"
                      count={allProjects.filter((p) => !p.pipeline_stage_id).length}
                      onToggle={() =>
                        setSelectedStageIds((prev) =>
                          prev.includes(NO_STAGE)
                            ? prev.filter((id) => id !== NO_STAGE)
                            : [...prev, NO_STAGE],
                        )
                      }
                    />
                  </div>
                </div>
              )}
            </div>
            {selectedStageIds.length > 0 && (
              <>
                <p className="mt-2 px-1 text-[10px] text-muted-foreground">
                  A project holds one stage, so several ticks mean any of them.
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedStageIds([])}
                  className="mt-1 w-full rounded-md py-1.5 text-center text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Clear stage filters
                </button>
              </>
            )}
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
                  No labels yet - theyÃ¢â‚¬â„¢ll appear here after your first visit.
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
                ? "RefreshingÃ¢â‚¬Â¦"
                : progress >= 1
                  ? "Release to refresh"
                  : "Pull to refresh"}
            </div>
          </div>
        )}

        {/* Same container as the project home page, so the content edge does not
            jump when you click through from this list into a project. */}
        <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-8 sm:px-8 md:px-10">
          {/* Hero - mockup-style: title, subtitle, primary action and a trash menu. */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-[560px]">
              <h1 className="font-sans text-2xl font-bold tracking-[-0.01em] text-foreground">
                Projects
              </h1>
              <p className="font-sans mt-1 text-[13.5px] leading-snug text-muted-foreground">
                {subtitleText}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                onClick={() =>
                  guard(
                    () => navigate({ to: "/projects/new" }),
                    "Subscribe to create new projects.",
                  )
                }
                className="font-sans h-10 rounded-lg bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" /> New project
              </Button>
              {/* Trash is a rare recovery action; it stays behind the page's
                  primary action, restyled to the reference quiet button. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="More project actions"
                    className="h-10 w-10 rounded-lg border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
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

          {/* Underline tabs, the same control every reference screen shares. */}
          <ReferenceTabStrip
            className="mt-6"
            items={tabs.map((t) => ({ key: t.key, label: t.label }))}
            value={tab}
            onChange={(key) => {
              const next = key as TabKey;
              setTab(next);
              /*
               * `replace`, not push. A tab is where you are on this screen, not
               * a place you travelled to: pushing would make Back walk you
               * through every pill you clicked before it left the page, which
               * is the behaviour people complain about. Replacing still gives
               * the tab an address to copy or bookmark, which is the point.
               */
              void navigate({
                to: "/projects",
                /*
                 * `prev` is annotated by cast rather than in the signature:
                 * TanStack types the reducer's argument as the union of every
                 * route's search schema, and `tab` now means one set of values
                 * here and another on /templates. Narrowing in the parameter
                 * position is what makes that union fail to line up.
                 */
                search: (prev) => ({
                  ...(prev as ProjectsIndexSearch),
                  tab: next === "projects" ? undefined : next,
                }),
                replace: true,
              });
            }}
          />

          {/* Filter pills + search - the mockup's row: pills left, search box right. */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {filterPills.map((pill) => {
                const selected = activePill === pill.key;
                return (
                  <button
                    key={pill.key}
                    type="button"
                    onClick={() => setPill(pill.key)}
                    aria-pressed={selected}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-[7px] text-[12.5px] font-semibold transition",
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {pill.label}
                    <span className={cn("font-mono text-[11px]", selected ? "text-background/70" : pill.toneClass)}>
                      {pill.count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="ml-auto w-full sm:w-60 md:w-[230px]">{searchInput}</div>
          </div>
          {tab === "projects" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">{filtersPopover}</div>
          )}
          {tab === "groups" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {filtersPopover}
              <Button
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-xs"
                onClick={() => setCreateGroupOpen(true)}
              >
                <FolderPlus className="h-3.5 w-3.5" /> New Group
              </Button>
            </div>
          )}

{/* Projects / Groups / Pipelines / Calendar */}
          <div>
            {/*
              No header on the Pipelines tab: the pipeline strip below already
              names the active pipeline, and the board view names it a third
              time. One title per screen - and it is why the search box and
              Filters button, which do not act on a board, disappear here.
            */}
            <div className={tab === "boards" || tab === "schedule" ? "mt-8" : "mt-5"}>
              {tab === "schedule" ? (
                <WorkspaceSchedule
                  schedule={schedule}
                  /*
                   * All THREE reads, and the third one is not optional.
                   *
                   * The "awaiting a date" rail is built by matching a project's
                   * stage name, so it needs the pipelines. Left out, this said
                   * `loading` was over while `stagesById` was still empty, no
                   * stage matched, and the tab drew "Nothing is dated yet" over
                   * a workspace that had a job sitting in Scheduled - then
                   * corrected itself a moment later when the boards landed. An
                   * empty state is a claim about the data, so it must not be
                   * made until every read behind it has answered.
                   */
                  loading={scheduleLoading || loading || boardsLoading}
                  error={scheduleError}
                  onRetry={refetchSchedule}
                  canSchedule={canSchedule}
                  onSetScheduledDate={(projectId, date) => void setScheduledDate(projectId, date)}
                />
              ) : tab === "groups" ? (
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
                    <PipelineTabStrip
                      boards={boards}
                      activeId={activeBoard?.id ?? null}
                      onSelect={(b) => {
                        // Picking a tab by hand releases the just-created guard:
                        // from here on the selection is the person's, not ours.
                        justCreatedBoardId.current = null;
                        setActiveBoard(b);
                      }}
                      onCreate={() => setCreateBoardOpen(true)}
                    />
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
                    <PipelineBoardView
                      board={activeBoard}
                      allProjects={allProjects}
                      coverUrls={coverUrls}
                      photoCounts={photoCounts}
                      reportCounts={reportCounts}
                      onManage={() => setManageBoardOpen(true)}
                      onStageChanged={setPipelineStageLocally}
                    />
                  ) : (
                    <EmptyState
                      icon={Layers}
                      title="No pipelines yet"
                      description="A pipeline is the process your work moves through, with a stage for each step (Lead/Quoted, Scheduled, In Progress, Completed, Invoiced, Paid). Every project sits in one stage at a time, and dragging its card is what moves it."
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
                  blueprintNames={blueprintNames}
                  coverUrls={coverUrls}
                  coverPaths={coverPaths}
                  coverThumbPaths={coverThumbPaths}
                  onStar={toggleStar}
                  onArchive={toggleArchive}
                />
              )}
            </div>
          </div>

          {activeBoard && (
            <BoardSettingsSheet
              open={manageBoardOpen}
              onOpenChange={setManageBoardOpen}
              board={activeBoard}
              otherBoardNames={boards.filter((b) => b.id !== activeBoard.id).map((b) => b.name)}
              tagNames={allTags.map((t) => t.name)}
              projectNames={allProjects.map((p) => p.name)}
              countByStageId={projectCountByStage}
              onUpdated={(updated) => {
                setBoards((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
                setActiveBoard(updated);
                // A removed stage clears pipeline_stage_id on the projects that
                // were in it (ON DELETE SET NULL), so the local rows have to
                // stop pointing at a column that no longer exists.
                const live = new Set(updated.stages.map((s) => s.id));
                setAllProjects((ps) =>
                  ps.map((p) =>
                    p.pipeline_stage_id && !live.has(p.pipeline_stage_id)
                      ? { ...p, pipeline_stage_id: null }
                      : p,
                  ),
                );
              }}
              onDeleted={(id) => {
                const gone = new Set(
                  (boards.find((b) => b.id === id)?.stages ?? []).map((s) => s.id),
                );
                setBoards((prev) => prev.filter((b) => b.id !== id));
                setActiveBoard(null);
                setAllProjects((ps) =>
                  ps.map((p) =>
                    p.pipeline_stage_id && gone.has(p.pipeline_stage_id)
                      ? { ...p, pipeline_stage_id: null }
                      : p,
                  ),
                );
              }}
            />
          )}

          <CreateBoardDialog
            open={createBoardOpen}
            onOpenChange={setCreateBoardOpen}
            existingBoardNames={boards.map((b) => b.name)}
            tagNames={allTags.map((t) => t.name)}
            projectNames={allProjects.map((p) => p.name)}
            onCreated={(board) => {
              setBoards((prev) => [board, ...prev]);
              // Select it, or creating a pipeline looks like it did nothing:
              // the tab appears somewhere in a strip that may already be
              // scrolled, and the board underneath keeps showing the old one.
              // The strip scrolls the selected tab into view.
              justCreatedBoardId.current = board.id;
              setActiveBoard(board);
              /*
               * Write it into the cache rather than invalidating.
               *
               * `invalidateQueries` here kicks off a refetch that races the
               * insert it is meant to pick up - and when the older response
               * wins, the list comes back without the new pipeline and the
               * selection jumps to a different tab. Seeding the cache keeps
               * the query and the local list saying the same thing, and the
               * next natural refetch reconciles from a point where the write
               * is definitely visible.
               */
              qc.setQueryData(
                qk.projectBoards(user?.id ?? ""),
                (prev: ProjectBoard[] | undefined) =>
                  prev ? [board, ...prev.filter((b) => b.id !== board.id)] : [board],
              );
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
            : 'Bundle projects that belong together - one client, one building, or a multi-site contract (e.g. "Starbucks Locations") - to see combined photos, stats, and shared views.'
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

function statusTone(s: string, archived?: boolean | null): "active" | "hold" | "complete" | "archived" {
  if (archived) return "archived";
  if (s === "on_hold") return "hold";
  if (s === "completed") return "complete";
  return "active";
}

function statusLabel(s: string, archived?: boolean | null): string {
  if (archived) return "Archived";
  return statusBadge(s).label;
}

function crewInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/**
 * Compact crew stack for the All Projects table: overlapping 22px avatars
 * with a 2px surface border, plus a "+N" overflow indicator.
 *
 * Kept separate from `ProjectCrew` so the list row can stay bare while the
 * header/grid keep their labeled, caption-bearing variant.
 */
function CrewCell({
  crew,
  extra,
  canAssign,
  onAssign,
}: {
  crew: TeamMemberLite[];
  extra: number;
  canAssign: boolean;
  onAssign: () => void;
}) {
  if (crew.length === 0 && !canAssign) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-0">
        <div className="flex -space-x-1.5">
          {crew.length === 0 && canAssign ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssign();
                  }}
                  className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-border bg-secondary/60 text-[10px] font-extrabold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  +
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Assign crew
              </TooltipContent>
            </Tooltip>
          ) : null}
          {crew.slice(0, 3).map((m) => (
            <Tooltip key={m.user_id}>
              <TooltipTrigger asChild>
                <Avatar className="h-[22px] w-[22px] border-2 border-border shrink-0">
                  {m.avatar_url ? (
                    <AvatarImage src={m.avatar_url} alt={m.full_name ?? m.email ?? ""} />
                  ) : null}
                  <AvatarFallback className="bg-foreground text-[9px] font-extrabold text-background">
                    {crewInitials(m.full_name ?? null, m.email ?? null)}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="font-medium">{m.full_name ?? m.email ?? "Teammate"}</div>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {extra > 0 && (
          <span className="ml-1.5 inline-flex h-[22px] items-center justify-center rounded-full border border-border bg-secondary/60 px-1 text-[10px] font-semibold text-muted-foreground">
            +{extra}
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * Hover-revealed kebab for the last column. Wrapped in a stop-propagation
 * div so the click that opens the menu does not also navigate the row link.
 */
function RowActions({
  project,
  canAssign,
  onAssign,
  onStar,
  onArchive,
}: {
  project: ProjectRow;
  canAssign: boolean;
  onAssign: () => void;
  onStar: (id: string, next: boolean) => void;
  onArchive: (id: string, next: boolean) => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onStar(project.id, !project.starred)}>
            <Star className={cn("mr-2 h-4 w-4", project.starred ? "fill-current text-foreground" : "text-muted-foreground")} />
            {project.starred ? "Unstar project" : "Star project"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onArchive(project.id, !project.archived)}>
            <Archive className={cn("mr-2 h-4 w-4", project.archived ? "text-status-complete" : "text-muted-foreground")} />
            {project.archived ? "Restore project" : "Archive project"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * One row of the All Projects table: 38px thumb + title/city, status pill,
 * blueprint name, overlapping crew avatars, relative last-activity time.
 */
function ProjectTableRow({
  project,
  blueprintName,
  coverUrl,
  coverPath,
  coverThumbPath,
  assigned,
  canAssign,
  onAssign,
  onStar,
  onArchive,
}: {
  project: ProjectRow;
  blueprintName?: string;
  coverUrl?: string;
  coverPath?: string;
  coverThumbPath?: string;
  assigned: string[];
  canAssign: boolean;
  onAssign: () => void;
  onStar: (id: string, next: boolean) => void;
  onArchive: (id: string, next: boolean) => void;
}) {
  const { members } = useTeamMembers();
  const crew = useMemo(() => {
    const byId = new Map(members.map((m) => [m.user_id, m]));
    return assigned
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .slice(0, 3);
  }, [members, assigned]);
  const extra = assigned.length - crew.length;
  const loc = projectLocation(project);

  return (
    <div className="group relative">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        className="grid min-w-0 grid-cols-[2.6fr_1fr_1.4fr_1fr_0.9fr] items-center gap-3 px-[18px] py-[14px] transition-colors hover:bg-secondary/50"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] bg-secondary text-muted-foreground">
            {coverUrl || coverPath ? (
              <PhotoThumb
                storagePath={coverPath}
                thumbPath={coverThumbPath}
                fallbackUrl={coverUrl}
                width={200}
                alt=""
              />
            ) : (
              <FolderKanban className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold leading-snug text-foreground">
              {project.name}
            </span>
            {loc && (
              <span className="block truncate text-[11.5px] text-muted-foreground">{loc}</span>
            )}
          </span>
        </span>
        <span>
          <ReferencePill tone={statusTone(project.status, project.archived)}>
            {statusLabel(project.status, project.archived)}
          </ReferencePill>
        </span>
        <span className="truncate text-[12.5px] text-muted-foreground">
          {blueprintName || <span className="text-faint">—</span>}
        </span>
        <CrewCell crew={crew} extra={extra} canAssign={canAssign} onAssign={onAssign} />
        <span className="flex items-center justify-end gap-1 text-[12px] text-muted-foreground">
          {timeAgo(project.updated_at)}
          <RowActions
            project={project}
            canAssign={canAssign}
            onAssign={onAssign}
            onStar={onStar}
            onArchive={onArchive}
          />
        </span>
      </Link>
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
  blueprintNames,
  onStar,
  onArchive,
}: {
  projects: ProjectRow[];
  loading: boolean;
  hasQueryOrFilter: boolean;
  onClearFilters: () => void;
  coverUrls: Record<string, string>;
  coverPaths: Record<string, string>;
  coverThumbPaths: Record<string, string>;
  blueprintNames: Record<string, string>;
  onStar: (id: string, next: boolean) => void;
  onArchive: (id: string, next: boolean) => void;
}) {
  /*
   * The crew on every visible card, in one request.
   *
   * Sliced to the RPC's own ceiling rather than paginated: this list is already
   * client-side filtered, and a workspace showing more than 200 cards at once
   * is scrolling past the point where a crew stack on card 201 is what anybody
   * is looking for. The cards past the cut simply render without one.
   */
  const { byProject, canAssign } = useProjectAssignees(
    useMemo(() => projects.slice(0, 200).map((p) => p.id), [projects]),
  );
  const [assignFor, setAssignFor] = useState<ProjectRow | null>(null);

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
    <>
      <div className={cn(REFERENCE_CARD, "overflow-hidden")}>
          {/* Column heads - uppercase eyebrow labels on a surface-2 wash. */}
          <div className="hidden grid-cols-[2.6fr_1fr_1.4fr_1fr_0.9fr] items-center gap-3 border-b border-border bg-secondary/60 px-[18px] py-3 md:grid">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Project</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Status</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Blueprint</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Crew</span>
            <span className="text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Last activity</span>
          </div>
          <div className="divide-y divide-border">
            {projects.map((p) => (
              <ProjectTableRow
                key={p.id}
                project={p}
                blueprintName={blueprintNames[p.id]}
                coverUrl={coverUrls[p.id]}
                coverPath={coverPaths[p.id]}
                coverThumbPath={coverThumbPaths[p.id]}
                assigned={byProject[p.id] ?? []}
                canAssign={canAssign}
                onAssign={() => setAssignFor(p)}
                onStar={onStar}
                onArchive={onArchive}
              />
            ))}
          </div>
        </div>

      {/*
      One dialog for the whole grid, opened with whichever card was clicked.
      Mounting one per card would build a modal for every project on the page
      in order to show at most one of them.
    */}
      {assignFor && (
        <AssignTeammatesDialog
          projectId={assignFor.id}
          projectName={assignFor.name}
          open
          onOpenChange={(o) => !o && setAssignFor(null)}
        />
      )}
    </>
  );
}
