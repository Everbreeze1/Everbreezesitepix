import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { can } from "@sitepix/shared/team-permissions";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutTemplate,
  Plus,
  Loader2,
  Trash2,
  ClipboardList,
  FileText,
  FolderOpen,
  Archive,
  ArchiveRestore,
  Lock,
  X,
  Search,
  Tag,
  Tags,
  Newspaper,
  MoreHorizontal,
  Copy,
  Pencil,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Rocket,
  Camera,
  Eye,
  Star,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { ChecklistTemplatesPage } from "@/features/settings/pages/ChecklistTemplatesPage";
import { WorkflowTemplatesPage } from "@/features/settings/pages/WorkflowTemplatesPage";
import { useConfirm } from "@/hooks/use-confirm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useQuery } from "@tanstack/react-query";
import { getMyTeam } from "@/features/settings/api";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageTabStrip } from "@/components/PageTabStrip";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { LabelChip, LabelPicker } from "@/features/photos/components/LabelPicker";
import { ApplyBlueprintDialog } from "@/features/settings/components/ApplyBlueprintDialog";
import { BlueprintOutcomePreview } from "@/features/settings/components/BlueprintOutcomePreview";
import {
  DESTINATION,
  KIND_OUTCOME,
  KIND_ORDER,
  SINGLETON_KINDS,
  destinationTotals,
  type BlueprintDestination,
  type BlueprintItemKind,
} from "@/features/settings/components/blueprint-outcomes";
import { WalkthroughTemplatesManager } from "@/features/settings/components/WalkthroughTemplatesManager";
import {
  BLUEPRINT_STARTERS,
  type BlueprintStarter,
} from "@/features/settings/components/blueprint-starters";
import { installBlueprintStarter } from "@/features/settings/components/install-blueprint-starter";
import { LabelsManager } from "@/features/settings/components/LabelsManager";
import { LabelSetsManager } from "@/features/settings/components/LabelSetsManager";
import { ReportTemplatesManager } from "@/features/settings/components/ReportTemplatesManager";
import { DocumentTemplatesManager } from "@/features/settings/components/DocumentTemplatesManager";
import {
  CATEGORY_ORDER,
  GENERAL_CATEGORY,
  categoryRank,
  makeCategoryRank,
} from "@/lib/template-categories";
import { useCompanySetup } from "@/hooks/use-company-setup";

import { ensureLabel, useLabelCatalog } from "@/hooks/use-label-catalog";

/**
 * Tab keys, exported so the route's `validateSearch` and this page cannot
 * disagree about what a valid tab is.
 */
export const TEMPLATE_TAB_KEYS = [
  "blueprints",
  "checklists",
  "workflows",
  "walkthroughs",
  "documents",
  "reports",
  "label-sets",
  "labels",
] as const;

export type TemplateTabKey = (typeof TEMPLATE_TAB_KEYS)[number];

export type TemplatesSearch = {
  tab?: TemplateTabKey;
  /** Opens straight to one blueprint - used by links from projects. */
  blueprint?: string;
};

interface ProjectTemplate {
  id: string;
  team_id: string | null;
  created_by: string;
  name: string;
  description: string | null;
  labels: string[] | null;
  archived: boolean;
  created_at: string;
  /** The trade this blueprint is for, from CATEGORY_ORDER. Null means General. */
  category: string | null;
  /** The one blueprint a new project of this trade starts from. */
  default_for_category: boolean;
  /**
   * Bumped by a trigger whenever the bundle gains or loses a section
   * (20260908000000). Stamped onto each apply so a project can say which shape
   * of the blueprint made it.
   */
  version: number;
}
interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
}
interface AttachedChecklist {
  id: string;
  project_template_id: string;
  checklist_template_id: string;
  position: number;
}

/**
 * Aliased to the shared union rather than restated.
 *
 * This file used to declare its own copy of the five kinds. That copy is what a
 * sixth kind has to be remembered in, and forgetting it is silent: the page
 * renders, the picker just never offers walkthroughs.
 */
type TemplateItemKind = BlueprintItemKind;
interface TemplateItem {
  id: string;
  project_template_id: string;
  kind: TemplateItemKind;
  ref_id: string;
  position: number;
}

/** One recorded apply, from the `project_blueprint_applications` ledger. */
interface BlueprintApplication {
  id: string;
  blueprint_id: string;
  project_id: string;
  created_at: string;
  counts: Record<string, number> | null;
  failed_count: number;
  project_name: string | null;
}

/**
 * A row in the blueprint's contents list.
 *
 * `legacy` rows live in `project_template_checklists`, which predates the
 * generic `project_template_items` table. Both still apply, so both have to be
 * editable here - see `persistOrder` for how reordering reconciles them.
 */
interface SectionRow {
  id: string;
  legacy: boolean;
  kind: TemplateItemKind;
  refId: string;
  name: string;
  missing: boolean;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

const KIND_META: Record<
  TemplateItemKind,
  { label: string; icon: typeof ClipboardList; tint: string }
> = {
  checklist: {
    label: KIND_OUTCOME.checklist.label,
    icon: ClipboardList,
    tint: KIND_OUTCOME.checklist.tint,
  },
  workflow: {
    label: KIND_OUTCOME.workflow.label,
    icon: WorkflowIcon,
    tint: KIND_OUTCOME.workflow.tint,
  },
  document: {
    label: KIND_OUTCOME.document.label,
    icon: FileText,
    tint: KIND_OUTCOME.document.tint,
  },
  walkthrough: {
    label: KIND_OUTCOME.walkthrough.label,
    icon: Camera,
    tint: KIND_OUTCOME.walkthrough.tint,
  },
  report: { label: KIND_OUTCOME.report.label, icon: Newspaper, tint: KIND_OUTCOME.report.tint },
  label_set: { label: KIND_OUTCOME.label_set.label, icon: Tag, tint: KIND_OUTCOME.label_set.tint },
};

/**
 * One pickable template in the "add a section" dropdown.
 *
 * `category` is the trade, and only document templates carry one - it is what
 * groups that dropdown, the same way the Documents tab and the in-project
 * picker group. Without it, choosing a document meant reading two dozen
 * near-identical names in one alphabetical run.
 */
interface LibraryEntry {
  id: string;
  name: string;
  category?: string | null;
}

/** The library split into trade sections, in the shared trade order. */
function byTrade(entries: LibraryEntry[]): Array<[string, LibraryEntry[]]> {
  const groups = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    const key = e.category || GENERAL_CATEGORY;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  return Array.from(groups.entries()).sort(
    (a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]),
  );
}

/**
 * Blank option value for the trade selects.
 *
 * Radix Select rejects an empty string as an item value, so "no trade" needs a
 * sentinel; it is translated back to null on every write.
 */
const NO_CATEGORY = "__none";

/** "Every trade" in the blueprint rail's filter. Same sentinel reasoning. */
const ALL_TRADES = "__all";

/**
 * The blueprints workspace fills whatever height is left under the hero.
 *
 * The three things a blueprint screen has to answer - what it is, what is in
 * it, and where it has been used - were three cards stacked down the page, so
 * answering the third meant scrolling past the first two and losing them. In
 * the `workspace` variant (see styles.css: wide enough for a second column and
 * tall enough to be worth pinning) the tab is one viewport-height workspace
 * instead: the rail, the contents and the usage list sit side by side and each
 * scrolls inside itself, so all three stay on screen at once.
 *
 * Deliberately not `h-[calc(100vh-22rem)]`. That number would be a guess at the
 * height of the app header, the hero, the tab strip and the page's own padding,
 * and it would be silently wrong the day any of them changes, a hero line wraps
 * or an account shows the upgrade banner. Instead the shell's `main`, this page
 * root, the container and this tab's wrapper form a flex chain from the window
 * down, every link of it `min-h-0`, so the leftover height is measured by the
 * layout rather than written down here.
 *
 * The `max-h` is the other half, and the one number that stays. `min-h-0` down
 * the chain is not enough on its own: the chain ends at the app shell, whose
 * row stretches to its tallest child, so a thirty-section blueprint still
 * pushed the whole document taller and put the panes back to scrolling the
 * page. The cap stops that at the source. It is a ceiling, never the layout -
 * `flex-1` above resolves first and always comes in under it - so the two
 * numbers only have to be roughly right, and only in one direction. Read them
 * as "the chrome above and below this tab, plus a few pixels of slack": if the
 * hero ever changes height, the worst that happens is a thin gap at the bottom
 * or a few pixels of page scroll on a blueprint long enough to hit the cap.
 * The two are mutually exclusive on purpose, so neither has to outrank the
 * other in the stylesheet.
 *
 * Outside the variant the cards stack and flow at their natural height, as
 * before.
 */
const WORKSPACE_HEIGHT = cn(
  "workspace:min-h-0 workspace:flex-1",
  "[@media(min-height:951px)]:workspace:max-h-[calc(100vh-29.5rem)]",
  "[@media(min-height:821px)_and_(max-height:950px)]:workspace:max-h-[calc(100vh-21.5rem)]",
  "[@media(max-height:820px)]:workspace:max-h-[calc(100vh-17.5rem)]",
);

/** Which library tab authors a given blueprint section kind. */
const KIND_TAB: Record<TemplateItemKind, TemplateTabKey> = {
  checklist: "checklists",
  workflow: "workflows",
  walkthrough: "walkthroughs",
  document: "documents",
  report: "reports",
  label_set: "label-sets",
};

export function TemplatesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_app/templates" });
  const fetchTeam = getMyTeam;
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await fetchTeam()) as any,
    enabled: !!user,
    staleTime: 60_000,
  });

  const { isPro, isTeam } = useSubscription();
  const myRole: string | null = teamData?.myRole ?? null;
  // `!myRole` is a solo user with no team at all - they own everything they
  // can see, so there is nobody to gate against.
  const canManage = !myRole || can(myRole, "manage_templates");
  const gated = !isPro;

  const tab: TemplateTabKey = search.tab ?? "blueprints";
  const setTab = useCallback(
    (next: TemplateTabKey) => {
      void navigate({
        to: "/templates",
        search: (prev: TemplatesSearch) => ({ ...prev, tab: next }),
        replace: true,
      });
    },
    [navigate],
  );

  const [tplItems, setTplItems] = useState<TemplateItem[]>([]);
  const [addKind, setAddKind] = useState<TemplateItemKind | "">("");
  const [addRefId, setAddRefId] = useState("");
  const [docTpls, setDocTpls] = useState<LibraryEntry[]>([]);
  const [reportTpls, setReportTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [labelSetTpls, setLabelSetTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [workflowTpls, setWorkflowTpls] = useState<Array<{ id: string; name: string }>>([]);
  const [walkthroughTpls, setWalkthroughTpls] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [attached, setAttached] = useState<AttachedChecklist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(search.blueprint ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [startersOpen, setStartersOpen] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState<string>(NO_CATEGORY);
  const [newLabels, setNewLabels] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [searchText, setSearchText] = useState("");
  /** Trade filter for the blueprint rail. `ALL_TRADES` is the unfiltered default. */
  const [tradeFilter, setTradeFilter] = useState<string>(ALL_TRADES);
  const [reordering, setReordering] = useState(false);

  const [applyOpen, setApplyOpen] = useState(false);

  /**
   * `null` means the ledger is unreadable - most likely migration
   * 20260810000000 has not been run on this environment yet. The usage panel
   * hides itself rather than showing a permanently empty "never used".
   */
  const [applications, setApplications] = useState<BlueprintApplication[] | null>(null);

  // Edit dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCategory, setEditCategory] = useState<string>(NO_CATEGORY);
  const [editDefault, setEditDefault] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadApplications = useCallback(async () => {
    const { data, error } = await supabase
      .from("project_blueprint_applications" as any)
      .select("id, blueprint_id, project_id, created_at, counts, failed_count, projects(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      // Reported, not swallowed. Without this line the usage panel simply
      // vanishes and there is nothing anywhere - console, UI or network tab
      // summary - saying the ledger could not be read.
      console.warn("[blueprint-applications] ledger read failed", {
        code: (error as { code?: string }).code,
        message: error.message,
      });
      setApplications(null);
      return;
    }
    setApplications(
      ((data as any[]) ?? []).map((r) => ({
        id: r.id,
        blueprint_id: r.blueprint_id,
        project_id: r.project_id,
        created_at: r.created_at,
        counts: (r.counts as Record<string, number> | null) ?? {},
        failed_count: r.failed_count ?? 0,
        project_name: r.projects?.name ?? null,
      })),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [tplRes, chkRes, attRes, itemsRes, docRes, repRes, lsRes, wfRes, wtRes] =
      await Promise.all([
        supabase
          .from("project_templates" as any)
          .select(
            "id, team_id, created_by, name, description, labels, archived, created_at, category, default_for_category, version",
          )
          .order("created_at", { ascending: true }),
        supabase
          .from("checklist_templates" as any)
          .select("id, name, description, archived")
          .order("created_at", { ascending: true }),
        supabase
          .from("project_template_checklists" as any)
          .select("id, project_template_id, checklist_template_id, position")
          .order("position", { ascending: true }),
        supabase
          .from("project_template_items" as any)
          .select("id, project_template_id, kind, ref_id, position")
          .order("position", { ascending: true }),
        supabase
          .from("document_templates" as any)
          // `body->>category`, not `body`: the trade is one short string, and the
          // bodies behind these rows are tens of kilobytes of document HTML each.
          // Selecting the whole column to read one key off it would pull the
          // entire built-in library down on every visit to this page.
          // `copiedFrom` comes along for the same price and keeps this dropdown
          // agreeing with the two screens that list the library - see `docTpls`.
          .select("id, name, archived, category:body->>category, copiedFrom:body->>copiedFrom")
          .eq("archived", false)
          .order("name"),
        supabase
          .from("report_templates" as any)
          .select("id, name, archived")
          .eq("archived", false)
          .order("name"),
        supabase
          .from("label_sets" as any)
          .select("id, name, archived")
          .eq("archived", false)
          .order("name"),
        supabase
          .from("workflow_templates" as any)
          .select("id, name, archived")
          .eq("archived", false)
          .order("name"),
        supabase
          .from("walkthrough_templates" as any)
          .select("id, name, archived, category")
          .eq("archived", false)
          .order("name"),
      ]);
    /*
     * The blueprint read is the one that can fail over a pending migration:
     * 20260908000000 adds three columns to `project_templates`, and PostgREST
     * rejects the whole select over one unknown column. Falling back to the old
     * column list keeps the page working on a database that has not been
     * migrated yet, rather than showing an empty blueprint library and no
     * explanation for it.
     */
    let tplRows = (tplRes.data as any[]) ?? [];
    if (tplRes.error) {
      const { data: legacyRows, error: legacyErr } = await supabase
        .from("project_templates" as any)
        .select("id, team_id, created_by, name, description, labels, archived, created_at")
        .order("created_at", { ascending: true });
      if (legacyErr) toast.error(legacyErr.message ?? "Couldn't load blueprints");
      tplRows = (legacyRows as any[]) ?? [];
    }
    // Defaulted here, once, so nothing downstream has to cope with the columns
    // being absent.
    const list = tplRows.map((t: any) => ({
      ...t,
      category: (t.category as string | null) ?? null,
      default_for_category: !!t.default_for_category,
      version: (t.version as number | undefined) ?? 1,
    })) as ProjectTemplate[];
    setTemplates(list);
    setChecklistTemplates(((chkRes.data as any[]) ?? []) as ChecklistTemplate[]);
    setAttached(((attRes.data as any[]) ?? []) as AttachedChecklist[]);
    setTplItems(((itemsRes.data as any[]) ?? []) as TemplateItem[]);
    /*
     * A built-in the team has made their own version of is dropped in favour of
     * that version, the same rule the Documents tab and the in-project picker
     * apply. Without it this dropdown is the one place left offering both, and
     * a blueprint could be built on the example a company has already replaced.
     */
    const docRows = (docRes.data as any[]) ?? [];
    const shadowed = new Set(docRows.map((x: any) => x.copiedFrom).filter(Boolean));
    setDocTpls(
      docRows
        .filter((x: any) => !shadowed.has(x.id))
        .map((x: any) => ({
          id: x.id,
          name: x.name,
          category: x.category ?? null,
        })),
    );
    setReportTpls(((repRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    setLabelSetTpls(((lsRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    setWorkflowTpls(((wfRes.data as any[]) ?? []).map((x: any) => ({ id: x.id, name: x.name })));
    // Absent rather than empty on a database still waiting for 20260908000000:
    // the read errors, `data` is null, and the picker simply offers no
    // walkthroughs. The library tab says so in full.
    setWalkthroughTpls(
      ((wtRes.data as any[]) ?? []).map((x: any) => ({
        id: x.id,
        name: x.name,
        category: x.category ?? null,
      })),
    );
    setSelectedId((cur) => {
      if (cur && list.find((t) => t.id === cur)) return cur;
      if (!list.length) return null;
      return (list.find((t) => !t.archived) ?? list[0])?.id ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user || gated) return;
    void load();
    void loadApplications();
  }, [user, gated, load, loadApplications]);

  // A `?blueprint=` link should win over whatever was selected, and only once -
  // the param is cleared so a later click in the rail is not snapped back.
  useEffect(() => {
    if (!search.blueprint) return;
    setSelectedId(search.blueprint);
    void navigate({
      to: "/templates",
      search: (prev: TemplatesSearch): TemplatesSearch => ({
        ...prev,
        tab: "blueprints",
        blueprint: undefined,
      }),
      replace: true,
    });
  }, [search.blueprint, navigate]);

  const labelCatalog = useLabelCatalog();

  // All labels = union of catalog + any used by templates (covers labels created elsewhere).
  const allLabels = useMemo(() => {
    const set = new Set<string>();
    for (const l of labelCatalog.rows) set.add(l.name);
    for (const t of templates) for (const l of t.labels ?? []) set.add(l);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [templates, labelCatalog.rows]);

  /** Section count per blueprint, across both storage tables. */
  const sectionCountByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of attached) m.set(a.project_template_id, (m.get(a.project_template_id) ?? 0) + 1);
    for (const i of tplItems) m.set(i.project_template_id, (m.get(i.project_template_id) ?? 0) + 1);
    return m;
  }, [attached, tplItems]);

  const applyCountByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of applications ?? []) m.set(a.blueprint_id, (m.get(a.blueprint_id) ?? 0) + 1);
    return m;
  }, [applications]);

  // Usage counts for the Labels tab.
  const templateUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of templates) {
      if (t.archived) continue;
      for (const l of t.labels ?? []) {
        const k = l.toLowerCase();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [templates]);

  const [projectUsage, setProjectUsage] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!user || gated) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("projects").select("labels").limit(1000);
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const row of (data as any[] | null) ?? []) {
        for (const l of (row.labels as string[] | null) ?? []) {
          const k = String(l).toLowerCase();
          m.set(k, (m.get(k) ?? 0) + 1);
        }
      }
      setProjectUsage(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, gated, tab]);

  /*
   * The blueprint rail sorts the way every other Templates tab sorts: the
   * company's own trade first.
   *
   * Blueprints were the last tab still on plain creation order, which was
   * defensible while they had no trade and stopped being so the moment they
   * did - a plumber scrolling past three roofing blueprints to reach theirs is
   * the same complaint that put `makeCategoryRank` on the other five tabs.
   *
   * Within a trade the default leads, because it is the one a new project of
   * that trade will start from and burying it alphabetically is what makes a
   * default worth nothing.
   */
  const company = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.profile.industry, company.profile.trades),
    [company.profile.industry, company.profile.trades],
  );

  const visibleTemplates = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return templates
      .filter((t) => {
        if (!showArchived && t.archived) return false;
        if (tradeFilter !== ALL_TRADES && (t.category || GENERAL_CATEGORY) !== tradeFilter) {
          return false;
        }
        if (q) {
          const hay =
            `${t.name} ${t.description ?? ""} ${t.category ?? ""} ${(t.labels ?? []).join(" ")}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          rank(a.category || GENERAL_CATEGORY) - rank(b.category || GENERAL_CATEGORY) ||
          Number(b.default_for_category) - Number(a.default_for_category) ||
          a.name.localeCompare(b.name),
      );
  }, [templates, showArchived, searchText, tradeFilter, rank]);

  /** Trades actually represented, so the filter never offers an empty result. */
  const tradesInUse = useMemo(() => {
    const present = new Set(
      templates
        .filter((t) => showArchived || !t.archived)
        .map((t) => t.category || GENERAL_CATEGORY),
    );
    return [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [templates, showArchived, rank]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const libFor = useCallback(
    (k: TemplateItemKind): LibraryEntry[] => {
      switch (k) {
        case "checklist":
          return checklistTemplates.map((c) => ({ id: c.id, name: c.name }));
        case "document":
          return docTpls;
        case "report":
          return reportTpls;
        case "label_set":
          return labelSetTpls;
        case "walkthrough":
          return walkthroughTpls;
        case "workflow":
          return workflowTpls;
      }
    },
    // A switch, not a nested ternary. The chain had "everything else is a
    // workflow" as its final branch, so adding a sixth kind would silently have
    // offered the workflow library under the walkthrough heading. This form
    // makes the compiler demand a branch per kind instead.
    [checklistTemplates, docTpls, reportTpls, labelSetTpls, walkthroughTpls, workflowTpls],
  );

  /**
   * The selected blueprint's contents in apply order.
   *
   * Legacy checklist links come first because `applyProjectBlueprintService`
   * processes them first - the list has to show the order that will actually
   * happen, not a prettier one.
   */
  const sections: SectionRow[] = useMemo(() => {
    if (!selectedId) return [];
    const nameOf = (kind: TemplateItemKind, refId: string) =>
      libFor(kind).find((x) => x.id === refId)?.name ?? null;
    const legacy: SectionRow[] = attached
      .filter((a) => a.project_template_id === selectedId)
      .map((a) => {
        const name = nameOf("checklist", a.checklist_template_id);
        return {
          id: a.id,
          legacy: true,
          kind: "checklist" as TemplateItemKind,
          refId: a.checklist_template_id,
          name: name ?? "Deleted checklist template",
          missing: name === null,
        };
      });
    const rest: SectionRow[] = tplItems
      .filter((i) => i.project_template_id === selectedId)
      .map((i) => {
        const name = nameOf(i.kind, i.ref_id);
        return {
          id: i.id,
          legacy: false,
          kind: i.kind,
          refId: i.ref_id,
          name: name ?? `Deleted ${KIND_META[i.kind].label.toLowerCase()} template`,
          missing: name === null,
        };
      });
    return [...legacy, ...rest];
  }, [selectedId, attached, tplItems, libFor]);

  /** Contents in the shape the outcome preview and the apply dialog expect. */
  const previewItems = useMemo(
    () => sections.filter((s) => !s.missing).map((s) => ({ kind: s.kind, name: s.name })),
    [sections],
  );

  const selectedApplications = useMemo(
    () => (applications ?? []).filter((a) => a.blueprint_id === selectedId),
    [applications, selectedId],
  );

  const updateLabels = async (t: ProjectTemplate, labels: string[]) => {
    const prev = templates;
    setTemplates((xs) => xs.map((x) => (x.id === t.id ? { ...x, labels } : x)));
    // Ensure new labels exist in the global catalog so their colors persist.
    if (user) {
      await Promise.all(labels.map((l) => ensureLabel(l, teamData?.team?.id ?? null, user.id)));
    }
    const { error } = await supabase
      .from("project_templates" as any)
      .update({ labels })
      .eq("id", t.id);
    if (error) {
      toast.error("Failed to update labels");
      setTemplates(prev);
    }
  };

  const createTemplate = async () => {
    if (!newName.trim() || !user) return;
    setCreating(true);
    try {
      // Persist new labels into the catalog first.
      await Promise.all(newLabels.map((l) => ensureLabel(l, teamData?.team?.id ?? null, user.id)));
      const { data, error } = await supabase
        .from("project_templates" as any)
        .insert({
          created_by: user.id,
          team_id: teamData?.team?.id ?? null,
          name: newName.trim(),
          description: newDesc.trim() || null,
          labels: newLabels,
          category: newCategory === NO_CATEGORY ? null : newCategory,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Failed");

      toast.success("Blueprint created");
      setNewName("");
      setNewDesc("");
      setNewCategory(NO_CATEGORY);
      setNewLabels([]);
      setCreateOpen(false);
      setSelectedId((data as any).id);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create blueprint");
    } finally {
      setCreating(false);
    }
  };

  /**
   * Installs a pre-built blueprint, building any component it needs first.
   *
   * The result is reported in full rather than as a bare success: the installer
   * may have created checklists and walkthroughs in the user's libraries, which
   * is a change to two other tabs and should not be silent, and it may have
   * skipped a piece, which would otherwise show up only as a blueprint with
   * fewer sections than the card promised.
   */
  const installStarter = async (starter: BlueprintStarter) => {
    if (!user) return;
    setInstalling(starter.name);
    try {
      const res = await installBlueprintStarter(starter, user.id, teamData?.team?.id ?? null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setStartersOpen(false);
      setSelectedId(res.blueprintId);
      await load();

      const builtLine = res.created.length
        ? `Also added ${res.created.length} piece${res.created.length === 1 ? "" : "s"} to your libraries.`
        : "";
      if (res.skipped.length) {
        toast.warning(
          `"${starter.name}" added with ${res.attached} of ${starter.pieces.length} sections`,
          {
            description: [builtLine, ...res.skipped.map((s) => `${s.name}: ${s.reason}`)]
              .filter(Boolean)
              .join(" "),
          },
        );
      } else {
        toast.success(`"${starter.name}" added`, {
          description: builtLine || undefined,
        });
      }
    } finally {
      setInstalling(null);
    }
  };

  const openEdit = (t: ProjectTemplate) => {
    setEditName(t.name);
    setEditDesc(t.description ?? "");
    setEditCategory(t.category ?? NO_CATEGORY);
    setEditDefault(t.default_for_category);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selected || !editName.trim()) return;
    setSavingEdit(true);
    const category = editCategory === NO_CATEGORY ? null : editCategory;
    const { error } = await supabase
      .from("project_templates" as any)
      .update({
        name: editName.trim(),
        description: editDesc.trim() || null,
        category,
        // A blueprint with no trade cannot be the default FOR a trade, so the
        // flag is forced off rather than left dangling when the trade is
        // cleared. The partial unique index ignores null categories, so a
        // dangling true would be storable and unreachable.
        default_for_category: category ? editDefault : false,
      })
      .eq("id", selected.id);
    setSavingEdit(false);
    if (error) {
      // The message matters here: the one error this update can realistically
      // hit is the partial unique index rejecting a second default for the same
      // trade, and "Failed to save" gives the user nothing to act on.
      const duplicate = (error as { code?: string }).code === "23505";
      toast.error(
        duplicate
          ? `Another blueprint is already the default for ${category}. Clear that one first.`
          : (error.message ?? "Failed to save"),
      );
      return;
    }
    toast.success("Blueprint updated");
    setEditOpen(false);
    void load();
  };

  const duplicateTemplate = async (t: ProjectTemplate) => {
    if (!user) return;
    const { data, error } = await supabase
      .from("project_templates" as any)
      .insert({
        created_by: user.id,
        team_id: teamData?.team?.id ?? null,
        name: `${t.name} (copy)`,
        description: t.description,
        labels: t.labels ?? [],
        category: t.category,
        // Deliberately NOT copied. Two blueprints cannot both be the default
        // for a trade, and the partial unique index would reject the insert -
        // so a duplicate that carried the flag could not be created at all.
        default_for_category: false,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Failed to duplicate");
      return;
    }
    const newId = (data as any).id as string;
    const links = attached.filter((a) => a.project_template_id === t.id);
    if (links.length) {
      const { error: linksErr } = await supabase.from("project_template_checklists" as any).insert(
        links.map((l) => ({
          project_template_id: newId,
          checklist_template_id: l.checklist_template_id,
          position: l.position,
        })),
      );
      if (linksErr) {
        toast.error(linksErr.message ?? "Couldn't copy this blueprint's checklists");
        void load();
        return;
      }
    }
    // Copying only the legacy checklist links silently dropped every document,
    // report, workflow and label set - a "duplicate" of a five-section
    // blueprint could come back with none of them.
    const items = tplItems.filter((i) => i.project_template_id === t.id);
    if (items.length) {
      const { error: itemsErr } = await supabase.from("project_template_items" as any).insert(
        items.map((i) => ({
          project_template_id: newId,
          kind: i.kind,
          ref_id: i.ref_id,
          position: i.position,
        })),
      );
      // Discarding this error reproduced the exact symptom the comment above
      // describes: the rows are selected correctly now, but a failed insert
      // still produced a "duplicated" blueprint with none of its sections.
      if (itemsErr) {
        toast.error(itemsErr.message ?? "Couldn't copy this blueprint's sections");
        void load();
        return;
      }
    }
    toast.success("Blueprint duplicated");
    setSelectedId(newId);
    void load();
  };

  const toggleArchived = async (t: ProjectTemplate) => {
    const { error } = await supabase
      .from("project_templates" as any)
      .update({ archived: !t.archived })
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else void load();
  };

  const deleteTemplate = async (t: ProjectTemplate) => {
    if (
      // Without confirmText the action button reads "Continue", which is a
      // strange thing for a permanent delete to say.
      !(await confirm({
        title: `Delete "${t.name}"?`,
        description:
          "Projects it has already been applied to keep everything it created. This cannot be undone.",
        confirmText: "Delete blueprint",
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from("project_templates" as any)
      .delete()
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else {
      if (selectedId === t.id) setSelectedId(null);
      void load();
    }
  };

  const addOfKind = async (k: TemplateItemKind, refId: string) => {
    if (!selectedId || !refId) return;
    /*
     * The dropdown already disables a singleton kind that is taken, but this is
     * the writer and the dropdown is not the only way in - two tabs open on the
     * same blueprint is enough. Checked here so the rule holds regardless of
     * which surface asked.
     */
    if (SINGLETON_KINDS.has(k) && sections.some((s) => s.kind === k && !s.missing)) {
      toast.error(
        `This blueprint already has a ${KIND_META[k].label.toLowerCase()}. Remove it first to swap in another.`,
      );
      return;
    }
    if (k === "checklist") {
      // New checklist links go into the generic table too. The legacy table is
      // read for what is already there, never written to again.
      const alreadyLegacy = attached.some(
        (a) => a.project_template_id === selectedId && a.checklist_template_id === refId,
      );
      if (alreadyLegacy) return;
    }
    const { error } = await supabase.from("project_template_items" as any).insert({
      project_template_id: selectedId,
      kind: k,
      ref_id: refId,
      // max+1 over this blueprint's rows, not `sections.length`. `removeSection`
      // never renumbers survivors, and `sections` also counts legacy
      // `project_template_checklists` rows - so length was both gap-blind and
      // inflated, and could hand the new section a number a sibling held.
      position:
        tplItems
          .filter((i) => i.project_template_id === selectedId)
          .reduce((max, i) => Math.max(max, i.position), -1) + 1,
    });
    if (error) toast.error(error.message ?? "Failed to add");
    else void load();
  };

  const removeSection = async (row: SectionRow) => {
    const table = row.legacy ? "project_template_checklists" : "project_template_items";
    if (row.legacy) setAttached((xs) => xs.filter((x) => x.id !== row.id));
    else setTplItems((xs) => xs.filter((x) => x.id !== row.id));
    const { error } = await supabase
      .from(table as any)
      .delete()
      .eq("id", row.id);
    if (error) {
      toast.error("Failed to remove");
      void load();
    }
  };

  /**
   * Writes a new section order.
   *
   * The apply service always runs legacy `project_template_checklists` rows
   * before `project_template_items`, so an order that interleaves the two
   * cannot be expressed while a blueprint still has legacy rows. Reordering
   * therefore migrates them first: copy each legacy link into the generic table
   * (dropping any that already exist there), then delete the legacy rows. The
   * copy is verified before the delete, so a failure leaves the blueprint
   * exactly as it was rather than half-moved.
   */
  const persistOrder = async (next: SectionRow[]) => {
    if (!selectedId) return;
    setReordering(true);
    try {
      const legacyRows = next.filter((r) => r.legacy);
      if (legacyRows.length) {
        const existingRefs = new Set(
          tplItems
            .filter((i) => i.project_template_id === selectedId && i.kind === "checklist")
            .map((i) => i.ref_id),
        );
        const toInsert = legacyRows.filter((r) => !existingRefs.has(r.refId));
        if (toInsert.length) {
          const { error } = await supabase.from("project_template_items" as any).insert(
            toInsert.map((r) => ({
              project_template_id: selectedId,
              kind: "checklist",
              ref_id: r.refId,
              position: next.indexOf(r),
            })),
          );
          if (error) throw error;
        }
        const { error: delErr } = await supabase
          .from("project_template_checklists" as any)
          .delete()
          .in(
            "id",
            legacyRows.map((r) => r.id),
          );
        if (delErr) throw delErr;
        // The insert above had no row ids to work with, so positions are only
        // correct relative to each other. Re-read to get the real ids, then
        // write the absolute order in one pass.
        const { data } = await supabase
          .from("project_template_items" as any)
          .select("id, kind, ref_id")
          .eq("project_template_id", selectedId);
        const idByRef = new Map(
          ((data as any[]) ?? []).map((r) => [`${r.kind}:${r.ref_id}`, r.id as string]),
        );
        const migrated = await Promise.all(
          next.map((r, idx) => {
            const id = idByRef.get(`${r.kind}:${r.refId}`);
            if (!id) return Promise.resolve();
            return supabase
              .from("project_template_items" as any)
              .update({ position: idx })
              .eq("id", id);
          }),
        );
        // Must throw so the catch below reports it. Silence here is the worst
        // case in this function: the legacy rows have already been migrated and
        // deleted above, so a failed position pass leaves the blueprint
        // permanently converted but still in the old order, saying nothing.
        const badMigrated = migrated.find((r: any) => r?.error);
        if (badMigrated) throw (badMigrated as any).error;
      } else {
        const results = await Promise.all(
          next.map((r, idx) =>
            supabase
              .from("project_template_items" as any)
              .update({ position: idx })
              .eq("id", r.id),
          ),
        );
        // Without this the reorder is a silent no-op: the spinner runs, the row
        // doesn't move, and the catch that would explain why never fires.
        const bad = results.find((r: any) => r?.error);
        if (bad) throw (bad as any).error;
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reorder sections");
      await load();
    } finally {
      setReordering(false);
    }
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    void persistOrder(next);
  };

  const tabCounts: Record<TemplateTabKey, number> = {
    blueprints: templates.filter((t) => !t.archived).length,
    checklists: checklistTemplates.filter((c) => !c.archived).length,
    workflows: workflowTpls.length,
    walkthroughs: walkthroughTpls.length,
    documents: docTpls.length,
    reports: reportTpls.length,
    "label-sets": labelSetTpls.length,
    labels: labelCatalog.rows.length,
  };
  if (teamLoading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 pt-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (gated) {
    return (
      <div className="container mx-auto max-w-3xl px-4 pb-24 pt-6">
        <Card className="mt-6 p-8 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">Upgrade to use Templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Build a job setup once, then apply it to every project. Available on the Pro and Team
            plans.
          </p>
          <Button className="mt-4" onClick={() => navigate({ to: "/pricing" })}>
            View plans
          </Button>
        </Card>
      </div>
    );
  }

  return (
    /*
     * Link one of the chain described on `WORKSPACE_HEIGHT`.
     *
     * `flex-1`, not the `min-h-screen` that used to be here. `100vh` is the
     * whole window, and this element starts below the app header - and below
     * the upgrade banner, on an account that has one - so `min-h-screen` was
     * always the window plus that chrome, which is why the page scrolled by
     * exactly the header's height no matter how little was on it. As a flex
     * item of `main` it takes the height that is actually left, and still
     * grows past it for the tabs that are long lists.
     */
    <div className="workspace:min-h-0 flex flex-1 flex-col bg-background">
      {/* pt-only responsive scaling. `md:py-10` used to sit here, and because a
          variant shorthand outranks the unvariated `pb-32`, desktop bottom
          padding collapsed to 40px - less than the 84px the floating camera
          button occupies, so the last row of every tab sat under it.
          `md:pb-10` is a deliberate exception rather than a repeat of that
          mistake: the bar this clears, MobileTabBar, is `md:hidden`, so above
          `md` the 128px is dead space - and it is dead space this page cannot
          afford, because it is subtracted from the height the blueprints
          workspace has to fit three panes into. */}
      {/* Link two. No `min-h-0`, on purpose: the container has to be free to
          grow past the viewport, both for the tabs that are long lists and for
          a short screen where the workspace hits its floor. */}
      <div className="container mx-auto px-3 pb-32 pt-4 sm:px-4 sm:pt-6 md:pb-10 md:pt-10 workspace:flex workspace:min-h-0 workspace:flex-1 workspace:flex-col [@media(max-height:950px)]:md:pb-4 [@media(max-height:950px)]:md:pt-5">
        {/* Hero - same shell, ornament, badge and stats rail as Projects and the
            project home page. Templates was the last product surface still
            wearing the plain settings header, which is most of why it read as a
            bolted-on admin screen rather than the thing the workflow runs on.

            The `max-height` variants are the one departure, and they are height
            variants rather than width ones on purpose: on a 800px-tall laptop
            the hero's 200px is the difference between the blueprints workspace
            fitting the screen and not, and a shorter window is exactly the case
            where a decorative band should yield to the working area. Nothing is
            removed above 950px. */}
        <div className="relative overflow-hidden rounded-[32px] bg-sidebar">
          <div className="pointer-events-none absolute -right-24 -top-28 h-[288px] w-[288px] rounded-full border-[28px] border-sidebar-ring/20" />
          <div className="relative flex flex-col gap-7 p-6 sm:px-10 sm:py-9 [@media(min-height:821px)_and_(max-height:950px)]:sm:py-5 [@media(max-height:820px)]:sm:py-3">
            <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                {/* The eyebrow goes at the third height band. It names the
                    section of the sidebar you clicked to get here, which is a
                    nicety at 1080px and 34px of an 800px window that the
                    section list needs more. 820px is the boundary because 768
                    and 800 are what a maximised window on an ordinary laptop
                    reports, and both should get the tight hero. */}
                <span className="inline-flex items-center rounded-full bg-sidebar-ring px-3 py-1 text-[10px] font-extrabold uppercase tracking-[1.4px] text-sidebar-foreground [@media(max-height:820px)]:hidden">
                  Workspace tools
                </span>
                <h1 className="font-display mt-3 truncate text-2xl font-bold leading-tight tracking-tight text-sidebar-foreground sm:text-3xl [@media(max-height:820px)]:mt-0 [@media(max-height:820px)]:text-xl [@media(max-height:820px)]:sm:text-2xl">
                  Templates
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-sidebar-foreground/60 [@media(max-height:950px)]:hidden">
                  Build a job setup once as a blueprint, then apply it to any project - its
                  checklists, workflows, documents, reports and labels all land in place.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {canManage && (
                  <Button
                    onClick={() => {
                      setTab("blueprints");
                      setCreateOpen(true);
                    }}
                    className="h-10 rounded-lg bg-sidebar-foreground px-5 font-bold text-sidebar shadow-sm hover:bg-sidebar-foreground/90"
                  >
                    <Plus className="mr-2 h-4 w-4 text-sidebar-ring" /> New blueprint
                  </Button>
                )}
              </div>
            </div>

            {/*
             * No stats rail here, deliberately, though Projects and the project
             * home page both carry one.
             *
             * On those screens the rail earns its space: every figure in it is a
             * filter, and clicking one cuts the list below to it. This page's
             * rail was three inert figures, and the PageTabStrip twelve pixels
             * underneath it already showed all three - "Library 2 blueprints" is
             * the first tab's count, and "33 reusable pieces" was the sum of the
             * other five. A band of numbers restating the band of numbers below
             * it is the "way too much information" complaint in one element.
             */}
          </div>
        </div>

        {/* The same strip Projects and the project home page use, so the three
            hub screens can no longer drift apart. */}
        <PageTabStrip
          className="mt-3.5"
          value={tab}
          onChange={(key) => setTab(key as TemplateTabKey)}
          items={[
            {
              key: "blueprints",
              label: "Project blueprints",
              count: tabCounts.blueprints,
              icon: FolderOpen,
            },
            {
              key: "checklists",
              label: "Checklists",
              count: tabCounts.checklists,
              icon: ClipboardList,
            },
            {
              key: "workflows",
              label: "Workflows",
              count: tabCounts.workflows,
              icon: WorkflowIcon,
            },
            {
              key: "walkthroughs",
              label: "Walkthroughs",
              count: tabCounts.walkthroughs,
              icon: Camera,
            },
            { key: "documents", label: "Documents", count: tabCounts.documents, icon: FileText },
            { key: "reports", label: "Reports", count: tabCounts.reports, icon: Newspaper },
            {
              key: "label-sets",
              label: "Label sets",
              count: tabCounts["label-sets"],
              icon: Tags,
            },
            { key: "labels", label: "Labels", count: tabCounts.labels, icon: Tag },
          ]}
        />

        {/* Link three, and only for the blueprints tab. The other tabs are
            ordinary lists that should flow down the page as they always have,
            so they stay a plain block child of the flex column. */}
        <div
          className={cn(
            "mt-6 [@media(max-height:950px)]:mt-4",
            tab === "blueprints" &&
              "workspace:flex workspace:min-h-0 workspace:flex-1 workspace:flex-col",
          )}
        >
          {tab === "blueprints" && (
            <BlueprintsTab
              loading={loading}
              canManage={canManage}
              isTeam={isTeam}
              templates={templates}
              visibleTemplates={visibleTemplates}
              sectionCountByTemplate={sectionCountByTemplate}
              applyCountByTemplate={applyCountByTemplate}
              applicationsAvailable={applications !== null}
              selectedApplications={selectedApplications}
              selected={selected}
              selectedId={selectedId}
              onSelect={setSelectedId}
              search={searchText}
              onSearch={setSearchText}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((s) => !s)}
              trades={tradesInUse}
              tradeFilter={tradeFilter}
              onTradeFilter={setTradeFilter}
              onCreate={() => setCreateOpen(true)}
              onStarters={() => setStartersOpen(true)}
              sections={sections}
              previewItems={previewItems}
              reordering={reordering}
              onMove={moveSection}
              onRemove={removeSection}
              onPickKind={(k) => {
                setAddKind(k);
                setAddRefId("");
              }}
              onApply={() => setApplyOpen(true)}
              onEdit={openEdit}
              onDuplicate={duplicateTemplate}
              onArchiveToggle={toggleArchived}
              onDelete={deleteTemplate}
              onUpdateLabels={updateLabels}
              allLabels={allLabels}
              teamId={teamData?.team?.id ?? null}
              userId={user?.id}
              onGoToTab={setTab}
              onUpgrade={() => navigate({ to: "/pricing" })}
            />
          )}

          {tab === "checklists" && <ChecklistTemplatesPage embedded />}
          {tab === "workflows" && <WorkflowTemplatesPage embedded />}
          {tab === "walkthroughs" && <WalkthroughTemplatesManager canManage={canManage} />}
          {tab === "documents" && (
            <DocumentTemplatesManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
          )}
          {tab === "reports" && (
            <ReportTemplatesManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
          )}
          {tab === "label-sets" && (
            <LabelSetsManager teamId={teamData?.team?.id ?? null} canManage={canManage} />
          )}
          {tab === "labels" && user && (
            <LabelsManager
              teamId={teamData?.team?.id ?? null}
              userId={user.id}
              canManage={canManage}
              templateUsage={templateUsage}
              projectUsage={projectUsage}
            />
          )}
        </div>
      </div>

      {/* Section picker for the chosen kind */}
      {canManage && addKind && (
        <Dialog
          open={!!addKind}
          onOpenChange={(o) => {
            if (!o) {
              setAddKind("");
              setAddRefId("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add {KIND_META[addKind].label.toLowerCase()}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{KIND_OUTCOME[addKind].becomes}.</p>
              {(() => {
                const used = new Set(
                  sections.filter((s) => s.kind === addKind).map((s) => s.refId),
                );
                const available = libFor(addKind).filter((x) => !used.has(x.id));
                if (available.length === 0) {
                  return (
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                      No more {KIND_META[addKind].label.toLowerCase()} templates available.{" "}
                      <button
                        className="font-semibold text-primary hover:underline"
                        onClick={() => {
                          const target = KIND_TAB[addKind];
                          setAddKind("");
                          setTab(target);
                        }}
                      >
                        Create one first
                      </button>
                      .
                    </div>
                  );
                }
                return (
                  <Select value={addRefId} onValueChange={setAddRefId}>
                    <SelectTrigger className="h-10 rounded-lg">
                      <SelectValue
                        placeholder={`Pick a ${KIND_META[addKind].label.toLowerCase()}…`}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Documents are the one library big enough to need trade
                          headings - two dozen of them, named alike. The other
                          kinds stay a plain list rather than growing a single
                          "General" heading over everything. */}
                      {addKind === "document"
                        ? byTrade(available).map(([heading, items]) => (
                            <SelectGroup key={heading}>
                              <SelectLabel>{heading}</SelectLabel>
                              {items.map((x) => (
                                <SelectItem key={x.id} value={x.id}>
                                  {x.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))
                        : available.map((x) => (
                            <SelectItem key={x.id} value={x.id}>
                              {x.name}
                            </SelectItem>
                          ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setAddKind("");
                  setAddRefId("");
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!addRefId}
                onClick={async () => {
                  const k = addKind;
                  const ref = addRefId;
                  setAddKind("");
                  setAddRefId("");
                  await addOfKind(k, ref);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add to blueprint
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create dialog */}
      {canManage && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New project blueprint</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Residential roof inspection"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description (optional)
                </label>
                <Textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="mt-1"
                  placeholder="When should the crew reach for this one?"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trade (optional)
                </label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Files this blueprint under a trade, and lets a new project of that trade start
                  from it in one tap.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Labels (optional)
                </label>
                <div className="mt-1 min-h-[44px] rounded-md border border-input bg-background px-2 py-2">
                  <LabelPicker
                    value={newLabels}
                    onChange={setNewLabels}
                    suggestions={allLabels}
                    triggerLabel="Add label"
                    teamId={teamData?.team?.id ?? null}
                    userId={user?.id}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Every project this blueprint is applied to picks these labels up.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void createTemplate()} disabled={!newName.trim() || creating}>
                {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Pre-built blueprints.
       *
       * "Ship 2-3 pre-built Blueprints by trade so companies see the pattern
       * before building their own, rather than starting from a blank screen."
       * Each card installs a whole job setup, building any checklist, workflow,
       * walkthrough or report it needs in the matching library first - so what
       * arrives is a bundle of real, editable components, not a special kind of
       * blueprint with content hidden inside it. */}
      {canManage && (
        <Dialog open={startersOpen} onOpenChange={(o) => !installing && setStartersOpen(o)}>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
            <DialogHeader className="border-b border-border px-5 py-4">
              <DialogTitle>Start from a pre-built blueprint</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Each of these bundles pieces from your libraries. Anything you don’t have yet gets
                built there first, so you can edit every piece afterwards like any other.
              </p>
              {BLUEPRINT_STARTERS.map((s) => {
                const busy = installing === s.name;
                return (
                  <button
                    key={s.name}
                    disabled={!!installing}
                    onClick={() => void installStarter(s)}
                    className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
                  >
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LayoutTemplate className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{s.name}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                        {s.description}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {s.pieces.map((p, i) => {
                          const Icon = KIND_META[p.kind].icon;
                          return (
                            <span
                              key={`${p.kind}-${i}`}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
                                KIND_META[p.kind].tint,
                              )}
                            >
                              <Icon className="h-2.5 w-2.5" />
                              {p.name}
                            </span>
                          );
                        })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit dialog */}
      {canManage && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit blueprint</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </label>
                <Textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trade
                </label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* The one-tap default. Disabled rather than hidden when no trade
                  is set, because "why can't I tick this" is answered by the
                  line under it, whereas a control that vanishes is not. */}
              <label
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5",
                  editCategory === NO_CATEGORY && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  checked={editDefault}
                  disabled={editCategory === NO_CATEGORY}
                  onChange={(e) => setEditDefault(e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    Default for {editCategory === NO_CATEGORY ? "this trade" : editCategory}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {editCategory === NO_CATEGORY
                      ? "Pick a trade above to make this the one a new project of that trade starts from."
                      : "A new project starts pre-selected on this blueprint. Only one blueprint per trade can be the default."}
                  </span>
                </span>
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={!editName.trim() || savingEdit}>
                {savingEdit && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selected && (
        <ApplyBlueprintDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          blueprintId={selected.id}
          blueprintName={selected.name}
          items={previewItems}
          labels={selected.labels ?? []}
          companyName={teamData?.team?.name ?? null}
          onApplied={() => void loadApplications()}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Blueprints tab                                                            */
/* -------------------------------------------------------------------------- */

function BlueprintsTab(props: {
  loading: boolean;
  canManage: boolean;
  isTeam: boolean;
  templates: ProjectTemplate[];
  visibleTemplates: ProjectTemplate[];
  sectionCountByTemplate: Map<string, number>;
  applyCountByTemplate: Map<string, number>;
  applicationsAvailable: boolean;
  selectedApplications: BlueprintApplication[];
  selected: ProjectTemplate | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (v: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  /** Trades present in the library, in the company's own order. */
  trades: string[];
  tradeFilter: string;
  onTradeFilter: (v: string) => void;
  onCreate: () => void;
  onStarters: () => void;
  sections: SectionRow[];
  previewItems: Array<{ kind: TemplateItemKind; name: string }>;
  reordering: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (row: SectionRow) => void;
  onPickKind: (k: TemplateItemKind) => void;
  onApply: () => void;
  onEdit: (t: ProjectTemplate) => void;
  onDuplicate: (t: ProjectTemplate) => void;
  onArchiveToggle: (t: ProjectTemplate) => void;
  onDelete: (t: ProjectTemplate) => void;
  onUpdateLabels: (t: ProjectTemplate, labels: string[]) => void;
  allLabels: string[];
  teamId: string | null;
  userId?: string;
  onGoToTab: (t: TemplateTabKey) => void;
  onUpgrade: () => void;
}) {
  const {
    loading,
    canManage,
    isTeam,
    templates,
    visibleTemplates,
    sectionCountByTemplate,
    applyCountByTemplate,
    applicationsAvailable,
    selectedApplications,
    selected,
    selectedId,
    onSelect,
    search,
    onSearch,
    showArchived,
    onToggleArchived,
    trades,
    tradeFilter,
    onTradeFilter,
    onCreate,
    onStarters,
    sections,
    previewItems,
    reordering,
    onMove,
    onRemove,
    onPickKind,
    onApply,
    onEdit,
    onDuplicate,
    onArchiveToggle,
    onDelete,
    onUpdateLabels,
    allLabels,
    teamId,
    userId,
    onGoToTab,
    onUpgrade,
  } = props;

  /*
   * Preview mode, from the spec: "show what a project would look like if this
   * Blueprint were applied."
   *
   * Collapsed by default because the Contents list below is the working view -
   * this is the answer to "what will this DO", which is a question you ask
   * before you apply, not while you are assembling. Opening it renders exactly
   * the panel the apply dialog and the new-project chooser render, so the three
   * places that make this promise cannot describe the same blueprint
   * differently.
   *
   * Declared above the early returns below: a hook after them would be a
   * conditional one.
   */
  const [previewOpen, setPreviewOpen] = useState(false);

  /*
   * Which of the two working panes is on screen, below the width where they
   * fit side by side.
   *
   * Under 1280px the panes cannot be columns, and stacked they were the whole
   * complaint: a blueprint with a dozen sections buried "Applied to" a screen
   * and a half below the fold, so checking which project a blueprint had
   * landed on meant scrolling down past every section and back up again. They
   * now share one slot with a two-way switch above it, so the second question
   * is a click away instead of a scroll away.
   *
   * Above 1280px both panes render and the switch is hidden, which is why this
   * is a class toggle rather than a conditional render: the wide layout must
   * never depend on this state, and a window dragged across the breakpoint
   * must not be able to leave a column missing.
   */
  const [pane, setPane] = useState<"contents" | "applied">("contents");

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (templates.length === 0) {
    return <BlueprintsIntro canManage={canManage} onCreate={onCreate} onStarters={onStarters} />;
  }

  const hasContent = previewItems.length > 0 || (selected?.labels?.length ?? 0) > 0;
  // Plain call, not a `useMemo` - this component returns early above, so a hook
  // here would be a conditional one. It is a walk over a handful of items.
  const lands = destinationTotals(previewItems, selected?.labels ?? []);

  /*
   * What sits behind each "Lands in" chip, so hovering one names the things
   * that land on that tab.
   *
   * This is the "hover to drop down instead of scrolling" half: the answer to
   * "what exactly does Workflows get" arrives over the layout instead of
   * pushing a panel into it, and the chip row it hangs off was already on
   * screen. Same walk over the same handful of items, for the same reason it
   * is not a hook.
   */
  const landedNames = new Map<BlueprintDestination, Array<{ name: string; label: string }>>();
  const pushLanded = (destination: BlueprintDestination, name: string, label: string) => {
    const bucket = landedNames.get(destination);
    if (bucket) bucket.push({ name, label });
    else landedNames.set(destination, [{ name, label }]);
  };
  for (const item of previewItems) {
    pushLanded(KIND_OUTCOME[item.kind].destination, item.name, KIND_OUTCOME[item.kind].label);
  }
  // The blueprint's own labels are not sections, but they land all the same -
  // the same reason `destinationTotals` counts them.
  for (const label of selected?.labels ?? []) pushLanded("labels", label, "Label");

  /*
   * `minmax(0,1fr)`, not `1fr`. A bare `1fr` track is `minmax(auto,1fr)`, so
   * the detail column could never be narrower than its own min-content - and
   * at 1024px that content wants about 534px of a 416px track, which the
   * browser resolves by widening the document and putting a horizontal
   * scrollbar under the whole app. The inner pane grid already spells its
   * tracks this way; this one was the last bare `1fr` left.
   */
  return (
    <div className={cn("grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]", WORKSPACE_HEIGHT)}>
      {/* Library rail */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search blueprints…"
            className="h-10 rounded-xl pl-9"
          />
        </div>

        {/* The trade filter the spec's "optional, for filtering later" asks for.
            Hidden below two trades, where it is a control with one meaningful
            position and nothing to narrow. */}
        {trades.length > 1 && (
          <Select value={tradeFilter} onValueChange={onTradeFilter}>
            <SelectTrigger className="h-9 rounded-xl text-xs font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TRADES}>All trades</SelectItem>
              {trades.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Create lives in the list header, not in a full-width button of its
            own above it. The hero already carries a primary "New blueprint" a
            couple of hundred pixels up, so this was the same action twice on
            one screen, the second time in a block as heavy as the list. */}
        <div className={cn(SURFACE_CARD, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* The count only while a search is narrowing the list, which is
                  the one case the tab strip's "Project blueprints 2" cannot
                  speak to. Unfiltered it was a third copy of that number. */}
              {search.trim() !== "" && (
                <span className="text-xs font-bold text-muted-foreground">
                  {visibleTemplates.length} match{visibleTemplates.length === 1 ? "" : "es"}
                </span>
              )}
              <button
                className="truncate text-xs font-bold text-muted-foreground hover:text-foreground"
                onClick={onToggleArchived}
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            </div>
            {canManage && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs font-bold"
                  onClick={onStarters}
                >
                  Starters
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs font-bold"
                  onClick={onCreate}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  New
                </Button>
              </div>
            )}
          </div>
          {visibleTemplates.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {/* Naming the filter that emptied the list, because a trade
                  filter set two visits ago is invisible otherwise and reads as
                  "my blueprints are gone". */}
              {tradeFilter === ALL_TRADES
                ? "No blueprints match your search."
                : `No ${tradeFilter} blueprints${search.trim() ? " match your search" : ""}.`}
            </p>
          ) : (
            /* Two caps, because the rail is two different things. Beside the
               detail it is a column and can take 62vh; stacked on top of it,
               below `lg`, every one of those pixels is pushed between you and
               the blueprint you just picked, so it scrolls inside 17rem
               instead. Pinned in the workspace it takes the height the flex
               chain measured and neither cap applies. */
            <ul className="max-h-[17rem] flex-1 divide-y divide-border/60 overflow-y-auto lg:max-h-[62vh] workspace:max-h-none">
              {visibleTemplates.map((t) => {
                const isSelected = selectedId === t.id;
                const sectionCount = sectionCountByTemplate.get(t.id) ?? 0;
                const applyCount = applyCountByTemplate.get(t.id) ?? 0;
                return (
                  <li key={t.id} className="relative">
                    {isSelected && (
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                    )}
                    <button
                      onClick={() => onSelect(t.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1.5 px-3.5 py-3 text-left transition-colors",
                        isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-bold">{t.name}</span>
                        {t.archived && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Archived
                          </Badge>
                        )}
                      </div>
                      {t.description && (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                      {/* Labels as quiet text, not as chips. The chip is a
                          skewed, saturated block built for sitting over a
                          photo; three of them per card turned a 320px rail
                          into the loudest thing on the page, and none of that
                          colour helps you pick a blueprint out of a list. The
                          detail panel still shows the real chips, where they
                          are the value being edited. */}
                      {(t.labels?.length ?? 0) > 0 && (
                        <span className="flex w-full min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Tag className="h-3 w-3 shrink-0" />
                          <span className="truncate">{t.labels!.join(", ")}</span>
                        </span>
                      )}
                      <div className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>
                          {sectionCount} section{sectionCount === 1 ? "" : "s"}
                        </span>
                        {applicationsAvailable && applyCount > 0 && (
                          <>
                            <span aria-hidden>·</span>
                            <span>used {applyCount}×</span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Detail */}
      {!selected ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-16 text-center">
          <Sparkles className="h-6 w-6 text-muted-foreground/70" />
          <p className="text-sm font-semibold">Select a blueprint</p>
          <p className="text-xs text-muted-foreground">
            Pick one from the list to see what it creates and apply it.
          </p>
        </Card>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Header. `shrink-0`, so the identity of the thing you are looking
              at is the one part of the workspace that never gets squeezed.
              Deliberately short: it sits directly on top of the two working
              panes, and on an 800px-tall laptop those panes get only what this
              card leaves them, so every row of chrome here is a row of section
              list somewhere else. It used to run four stacked rows (title,
              description, meta, labels) at 194px tall; it is now two, and the
              panes below gained the difference. */}
          <div className={cn(SURFACE_CARD, "shrink-0 px-4 py-3 sm:px-5 sm:py-3.5")}>
            {/* Stacked below `sm`. Side by side, the action group is ~230px of
                shrink-0 buttons and the title is the only thing left that can
                give, so a phone truncated the blueprint's name to three
                characters to hold a row of buttons intact. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
              {/* `min-w-[10rem]`, not `min-w-0`. The action group beside this is
                  ~290px of shrink-0 buttons, so on a 416px detail column a
                  plain `min-w-0` let the name shrink all the way to "Z..."
                  while the buttons kept every pixel. The floor makes the row
                  wrap the buttons to a second line instead, which costs 40px
                  once and keeps the name of the thing you are looking at
                  readable. Above 1152px there is room for both and nothing
                  wraps. */}
              <div className="min-w-[10rem] flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <LayoutTemplate className="h-4 w-4" />
                  </span>
                  <h2 className="font-display truncate text-lg font-bold tracking-tight">
                    {selected.name}
                  </h2>
                  {selected.archived && <Badge variant="outline">Archived</Badge>}
                </div>
                {/* One line, then an ellipsis with the rest on hover, and no
                    line at all on a short window. A long description is the one
                    field on this card that can grow without limit, and every
                    line it grows by comes off the panes below it. Nothing is
                    lost when it goes: the rail row you picked this blueprint
                    from prints the same description, and the full text is on
                    the title attribute either way. */}
                {selected.description && (
                  <p
                    className="mt-1 line-clamp-1 max-w-2xl text-[13px] text-muted-foreground [@media(max-height:950px)]:hidden"
                    title={selected.description}
                  >
                    {selected.description}
                  </p>
                )}
              </div>

              {/* One primary, one secondary, one overflow. Four buttons of
                  equal weight made the row a menu bar and left nothing
                  obviously the thing to press. */}
              <div className="flex shrink-0 items-center gap-2">
                {isTeam ? (
                  <Button
                    size="sm"
                    className="rounded-lg"
                    onClick={onApply}
                    disabled={!hasContent}
                    title={hasContent ? undefined : "Add at least one section or label first"}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Apply to projects
                  </Button>
                ) : (
                  // Applying is enforced as a Team feature server-side. Saying
                  // so here beats letting someone build a blueprint and meet
                  // the restriction only at the moment they try to use it.
                  <Button size="sm" className="rounded-lg" onClick={onUpgrade}>
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    Applying is on Team
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(selected)}
                    className="rounded-lg"
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
                {(isTeam || canManage) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        aria-label="More actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {isTeam && (
                        <DropdownMenuItem asChild>
                          <Link to="/projects/new" search={{ blueprint: selected.id }}>
                            <Plus className="mr-2 h-4 w-4" />
                            New project from this
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {canManage && (
                        <>
                          {isTeam && <DropdownMenuSeparator />}
                          <DropdownMenuItem onClick={() => onDuplicate(selected)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onArchiveToggle(selected)}>
                            {selected.archived ? (
                              <>
                                <ArchiveRestore className="mr-2 h-4 w-4" />
                                Unarchive
                              </>
                            ) : (
                              <>
                                <Archive className="mr-2 h-4 w-4" />
                                Archive
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => onDelete(selected)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {/* Trade, version, created date, the default flag and the labels,
             * all on one line, spanning the whole card.
             *
             * Spanning is the point. Inside the title column this row shares
             * its width with the action buttons, and at 1280px that is narrow
             * enough that two labels and the Add trigger wrap to a third line -
             * which is exactly the height this card was rewritten to give back.
             * Below the buttons it has the full measure and stays one line.
             *
             * The labels used to own a row of their own with a rule above it,
             * and they are the same class of fact as the trade: what this
             * blueprint is filed under, not something you work on here. The
             * section count and the apply count are deliberately absent - both
             * are stated in full a few pixels below, at the head of the card
             * that acts on them. The version is the spec's audit half: the
             * bundle is copied on apply, so this number is what lets a project
             * say which shape of the blueprint made it.
             *
             * A div rather than the p this used to be, because LabelPicker is a
             * flex container and cannot live inside a paragraph. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              <span>{selected.category ?? GENERAL_CATEGORY}</span>
              <span aria-hidden>·</span>
              <span>v{selected.version}</span>
              <span aria-hidden>·</span>
              <span>Created {timeAgo(selected.created_at)}</span>
              {selected.default_for_category && selected.category && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-bold text-primary"
                  title={`New ${selected.category} projects start from this blueprint`}
                >
                  <Star className="h-2.5 w-2.5" />
                  Default for {selected.category}
                </span>
              )}
              <span aria-hidden className="mx-1 h-3 w-px shrink-0 bg-border/70" />
              {canManage ? (
                <LabelPicker
                  value={selected.labels ?? []}
                  onChange={(next) => onUpdateLabels(selected, next)}
                  suggestions={allLabels}
                  triggerLabel="Add label"
                  teamId={teamId}
                  userId={userId}
                  size="sm"
                />
              ) : (selected.labels?.length ?? 0) === 0 ? (
                <span>No labels</span>
              ) : (
                (selected.labels ?? []).map((l) => <LabelChip key={l} label={l} size="sm" />)
              )}
            </div>
          </div>

          {/*
           * The same two questions, one at a time, below the width where they
           * can be columns.
           *
           * Under 1280px the grid collapses to one column and the panes stack,
           * which is what put "Applied to" a full section list below the fold:
           * on a blueprint with a dozen sections, answering "which project is
           * this on" meant scrolling down past every section and then back up
           * to carry on editing. Both panes now share one slot and this switch
           * chooses between them, so the trip is a click rather than a scroll.
           *
           * Hidden from 1280px up, where both are on screen at once and there
           * is nothing to choose.
           */}
          {/* A pressed-state group rather than a tablist, deliberately. Above
              `xl` both cards are on screen and this control is not, so there is
              no width at which one of them is "the unselected tab" - calling
              them tabs would announce a state that only half the layout has. */}
          <div
            role="group"
            aria-label="Show contents or applied projects"
            className="flex shrink-0 items-center gap-1 rounded-xl border border-border/60 bg-muted/40 p-1 xl:hidden"
          >
            {(
              [
                { key: "contents", label: "Contents", count: sections.length },
                {
                  key: "applied",
                  label: "Applied to",
                  count: applicationsAvailable ? selectedApplications.length : null,
                },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={pane === t.key}
                onClick={() => setPane(t.key)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                  pane === t.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.count !== null && (
                  <span
                    className={cn(
                      "tabular-nums",
                      pane === t.key ? "text-muted-foreground" : "text-muted-foreground/70",
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/*
           * The two working panes, side by side above `xl`.
           *
           * What is in the blueprint and where it has been applied are the two
           * questions this screen exists to answer, and they used to be answered
           * one under the other, so reading the second scrolled the first off
           * the top. They are now columns of one fixed-height row: each scrolls
           * inside itself, neither pushes the other off screen, and the header
           * above them stays put while you read either one.
           */}
          {/* Three widths for the usage column, as non-overlapping ranges.
              16rem is all a 1280px window can spare once the sidebar and the
              blueprint rail have taken theirs, and at that width a project
              name is mostly ellipsis - so every pixel past 1400px goes here
              first, because "which project did this land on" is unanswerable
              from "20 Charlcote Cr...". Written as explicit ranges rather than
              a base plus overrides so none of them has to outrank another in
              the stylesheet.

              `max-xl:min-h` is for the switched layout below them: without a
              floor, flipping to an 'Applied to' that says "not applied to any
              project yet" collapsed the row to two lines and took the rail and
              everything under it up with it, so the switch itself jumped out
              from under the pointer. 13rem and not more: the floor has to be
              tall enough to hold a card with one line of text in it and short
              enough that a 720px-tall window still fits the whole tab without
              scrolling, which is the thing all of this is for. */}
          <div className="grid min-h-0 max-xl:min-h-[13rem] flex-1 grid-cols-[minmax(0,1fr)] gap-4 [@media(min-width:1280px)_and_(max-width:1399px)]:grid-cols-[minmax(0,1fr)_16rem] [@media(min-width:1400px)_and_(max-width:1535px)]:grid-cols-[minmax(0,1fr)_20rem] [@media(min-width:1536px)]:grid-cols-[minmax(0,1fr)_22rem]">
            {/* Contents, and where they land.
             *
             * These were two cards. The upper one grouped every item by its
             * destination and named it; the lower one listed the same items
             * again in apply order, to be edited. Same facts, twice, one above
             * the other. The destination summary is now a single row of counts
             * and the naming happens once, in the list you can actually
             * reorder. The full grouped picture still runs in the apply dialog,
             * at the moment it decides something. */}
            <div
              className={cn(
                SURFACE_CARD,
                "flex min-h-0 min-w-0 flex-col p-4 sm:p-5",
                // Only below `xl`, where the switch above is what is choosing.
                pane !== "contents" && "max-xl:hidden",
              )}
            >
              {/* The count sits under the row rather than beside the heading.
                  Beside it, the heading block and the two buttons together
                  wanted more than this column has at 1280px, so the buttons
                  wrapped to a second line and the head grew by 44px - which
                  comes straight off the list, the one thing in the card worth
                  the space. */}
              <div className="flex shrink-0 items-center justify-between gap-3">
                <h3 className="truncate text-sm font-bold tracking-tight">Contents</h3>
                <div className="flex shrink-0 items-center gap-2">
                  {/*
                   * The full "here is the project you get" picture, in a
                   * popover rather than an inline panel.
                   *
                   * Expanded in place it was 200-400px of card shoved between
                   * the section list and everything under it, which pushed the
                   * usage list off the screen the moment you asked the one
                   * question it answers. Floating over the layout, it costs
                   * nothing below it and closes on `Esc` or a click away.
                   */}
                  <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-lg"
                        disabled={!hasContent}
                        title={hasContent ? undefined : "Add at least one section or label first"}
                      >
                        <Eye className="mr-1.5 h-4 w-4" />
                        Preview
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-3"
                    >
                      <p className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                        A project with this blueprint applied
                      </p>
                      <BlueprintOutcomePreview
                        className="mt-2"
                        items={previewItems}
                        labels={selected.labels ?? []}
                        projectName={null}
                        dense
                      />
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        Everything here is copied onto the project at the moment you apply it.
                        Editing this blueprint afterwards leaves those projects exactly as they are.
                      </p>
                    </PopoverContent>
                  </Popover>
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" className="rounded-lg">
                          <Plus className="mr-1.5 h-4 w-4" />
                          Add section
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {KIND_ORDER.map((k) => {
                          const Icon = KIND_META[k].icon;
                          /*
                           * "zero-to-one workflow", from the spec. A workflow
                           * becomes the project's status tracker and a project has
                           * one status, so a second one has no meaning. Disabled
                           * with the reason on the row rather than hidden: a kind
                           * that vanishes from the menu reads as a bug, and the
                           * author would go looking for it.
                           */
                          const taken =
                            SINGLETON_KINDS.has(k) &&
                            sections.some((s) => s.kind === k && !s.missing);
                          return (
                            <DropdownMenuItem
                              key={k}
                              className="items-start gap-2"
                              disabled={taken}
                              onClick={() => onPickKind(k)}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded",
                                  KIND_META[k].tint,
                                )}
                              >
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm font-semibold">
                                  {KIND_META[k].label}
                                </span>
                                <span className="block text-[11px] leading-snug text-muted-foreground">
                                  {taken
                                    ? `Already in this blueprint. A blueprint carries at most one ${KIND_META[k].label.toLowerCase()}.`
                                    : KIND_OUTCOME[k].becomes}
                                </span>
                              </span>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>

              {/* "What happens when I apply this", in one row instead of a
                panel: the project tabs that gain something, and how much. Each
                chip opens on hover or focus to name what lands there, so the
                detail is a pointer-move away rather than a scroll away.

                The section count reads into this sentence rather than sitting
                on a line of its own under the heading. Two lines of small grey
                type over a list that only has room for three rows is the wrong
                trade, and the two facts were always one sentence: this many
                sections, applied in this order, landing here. */}
              {lands.length > 0 && (
                <div className="mt-2.5 flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {sections.length > 0
                      ? `${sections.length} section${sections.length === 1 ? "" : "s"}, applied in order, landing in`
                      : "Landing in"}
                  </span>
                  {lands.map(({ destination, count }) => {
                    const dest = DESTINATION[destination];
                    const DestIcon = dest.icon;
                    const names = landedNames.get(destination) ?? [];
                    return (
                      <HoverCard key={destination} openDelay={120} closeDelay={80}>
                        <HoverCardTrigger asChild>
                          {/* A button, not a span: hover alone would leave this
                            row unreachable by keyboard, and Radix opens the
                            card on focus for anything focusable. */}
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <DestIcon className="h-3 w-3" />
                            {dest.tab}
                            <span className="text-foreground">+{count}</span>
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent
                          align="start"
                          className="max-h-[50vh] w-72 overflow-y-auto p-3"
                        >
                          <p className="text-xs font-bold text-foreground">
                            {dest.scope === "workspace" ? "Your workspace" : "The project"} →{" "}
                            {dest.tab}
                          </p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                            {dest.blurb}
                          </p>
                          <ul className="mt-2 space-y-1">
                            {names.map((n, i) => (
                              <li
                                key={`${destination}-${i}-${n.name}`}
                                className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1"
                              >
                                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-foreground">
                                  {n.name}
                                </span>
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                                  {n.label}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </HoverCardContent>
                      </HoverCard>
                    );
                  })}
                </div>
              )}

              {sections.length === 0 ? (
                <div className="mt-4 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center">
                  <LayoutTemplate className="h-6 w-6 text-muted-foreground/70" />
                  <p className="mt-2 text-sm font-semibold">Nothing attached yet</p>
                  <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    A blueprint is a bundle of things you have already built. Add checklists,
                    workflows, documents, reports or label sets and they all land on the project in
                    one click.
                  </p>
                  {/* The "build the piece first" pointer lives here and only
                    here. It used to sit under every populated list too, five
                    inline links deep, where the answer was already known. */}
                  {canManage && (
                    <p className="mt-3 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                      Need a new piece first? Build it under{" "}
                      {(
                        ["checklists", "workflows", "documents", "reports", "label-sets"] as const
                      ).map((key, i, arr) => (
                        <span key={key}>
                          <button
                            className="font-semibold text-primary hover:underline"
                            onClick={() => onGoToTab(key)}
                          >
                            {key === "label-sets"
                              ? "Label sets"
                              : key[0].toUpperCase() + key.slice(1)}
                          </button>
                          {i < arr.length - 2 ? ", " : i === arr.length - 2 ? " or " : ""}
                        </span>
                      ))}
                      , then come back here and add it.
                    </p>
                  )}
                </div>
              ) : (
                // The pane's scroller. A twenty-section blueprint scrolls here,
                // inside its own column, instead of scrolling the page and
                // taking the header and the usage list with it.
                /* `max-h` for every layout except the pinned one, where the
                   flex chain has already measured the height and a cap would
                   only fight it. Without it a thirty-section blueprint on a
                   narrow window is thirty rows of page scroll again, which is
                   the thing the switch above exists to stop. */
                <ul className="@container mt-4 max-h-[46vh] min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 workspace:max-h-none">
                  {sections.map((r, idx) => {
                    const meta = KIND_META[r.kind];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={`${r.legacy ? "chk" : "it"}-${r.id}`}
                        className="group flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:border-border"
                      >
                        {/* Position as a number, not a chip. A filled badge next
                          to a tinted icon read as two icons. */}
                        <span className="w-3.5 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground/70">
                          {idx + 1}
                        </span>
                        <span
                          className={cn(
                            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            meta.tint,
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        {/* One line. The kind used to be stated three times per
                          row - tinted icon, outlined badge, and a sentence
                          spelling out what it becomes - which is what made a
                          five-section blueprint a wall. The icon carries the
                          kind, the word beside it names it, and the "Lands in"
                          row above says where it all goes. */}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-sm font-semibold",
                              r.missing && "text-destructive",
                            )}
                          >
                            {r.name}
                          </span>
                          {r.missing && (
                            <span className="block truncate text-[11px] text-destructive/80">
                              The source template was deleted - remove this section
                            </span>
                          )}
                        </span>
                        {/* The kind in words, but only where the column is
                            wide enough to spend 65px on it. A container query
                            and not a media query: this list is a narrow second
                            column at 1280px and a full-width pane at 1024px,
                            so window width is the wrong question. Where it is
                            hidden the tinted icon still carries the kind, and
                            the 65px goes to the name, which was truncating to
                            "Pre-Install Saf...". */}
                        <span className="hidden shrink-0 text-[11px] text-muted-foreground @min-[26rem]:block">
                          {meta.label}
                        </span>
                        {/* Revealed on hover or keyboard focus on a pointer
                          device, always present on touch, where there is no
                          hover to reveal them with. Space is reserved either
                          way, so nothing shifts. */}
                        {canManage && (
                          <div className="flex shrink-0 items-center transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground disabled:opacity-30"
                              disabled={idx === 0 || reordering}
                              onClick={() => onMove(idx, -1)}
                              aria-label={`Move ${r.name} up`}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground disabled:opacity-30"
                              disabled={idx === sections.length - 1 || reordering}
                              onClick={() => onMove(idx, 1)}
                              aria-label={`Move ${r.name} down`}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => onRemove(r)}
                              aria-label={`Remove ${r.name}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/*
             * Applied to.
             *
             * The card stays mounted when the ledger is unreadable and says so,
             * rather than deleting itself. Hiding it meant the one screen that
             * answers "where has this blueprint been used" silently ceased to
             * exist, and nothing distinguished that from a blueprint that had
             * genuinely never been applied.
             *
             * Titled "Applied to" rather than "Where it has been used" since it
             * became a 20rem column: the short title is the one that survives
             * the narrower measure, and it names the same thing.
             */}
            <div
              className={cn(
                SURFACE_CARD,
                "flex min-h-0 min-w-0 flex-col p-4 sm:p-5",
                pane !== "applied" && "max-xl:hidden",
              )}
            >
              <div className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-sm font-bold tracking-tight">Applied to</h3>
                {/* The count lives with the list it counts. The blueprint's own
                  header used to carry it as well, one card up. */}
                {applicationsAvailable && selectedApplications.length > 0 && (
                  <span className="text-[11.5px] text-muted-foreground">
                    {selectedApplications.length} project
                    {selectedApplications.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {/* Nothing to show is one quiet line, not a 90px dashed box drawn
                around a sentence saying there is nothing to show. */}
              {!applicationsAvailable ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  Usage history isn’t available on this environment yet, so we can’t show where this
                  blueprint has been applied.
                </p>
              ) : selectedApplications.length === 0 ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  Not applied to any project yet. Every apply is recorded here, with what it
                  created.
                </p>
              ) : (
                /* The whole ledger, scrolled inside the column. It used to stop
                 at twelve and say "and N more", because past twelve the page
                 itself was the scrollbar; the column has its own now, so the
                 truncation has nothing left to protect. */
                /* `workspace:pb-12` clears the floating camera button, which is
                   fixed to the bottom right of the window and so lands on this
                   column and no other. Before the panes reached the bottom of
                   the screen it sat over page padding and hit nothing; now the
                   last row of the ledger ends where it begins, instead of
                   under it where it cannot be clicked. */
                <ul className="mt-3 max-h-[46vh] min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 workspace:max-h-none workspace:pb-12">
                  {selectedApplications.map((a) => {
                    const total = Object.values(a.counts ?? {}).reduce((x, y) => x + y, 0);
                    return (
                      <li key={a.id}>
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: a.project_id }}
                          // Even at its widest this column truncates the longer
                          // job names, so the full one is on hover.
                          title={a.project_name ?? "Project"}
                          className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:border-primary/30"
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                            <FolderOpen className="h-3.5 w-3.5" />
                          </span>
                          {/* No chevron. It cost 24px of a column whose whole
                              job is fitting a project name, and the row is a
                              link that already lifts its border on hover. */}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {a.project_name ?? "Project"}
                            </span>
                            {/* "3 items · 2d ago", not "3 items created · 2d
                                ago". The verb was the first thing to be cut
                                off, and the card it sits under is titled
                                "Applied to", which supplies it. */}
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {total} item{total === 1 ? "" : "s"}
                              {a.failed_count > 0 ? ` · ${a.failed_count} failed` : ""} ·{" "}
                              {timeAgo(a.created_at)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  First-run explainer                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The zero-blueprint state does the teaching.
 *
 * "We have templates, but how do we apply them to projects, and how is that
 * going to look?" is not a question an empty list with a Create button
 * answers. Three steps, in the order the user will do them.
 */
function BlueprintsIntro({
  canManage,
  onCreate,
  onStarters,
}: {
  canManage: boolean;
  onCreate: () => void;
  onStarters: () => void;
}) {
  const steps = [
    {
      icon: LayoutTemplate,
      title: "Build the pieces",
      body: "Checklists, workflows, walkthroughs, documents, reports and label sets - each on its own tab above. Anything you save from a project lands there too.",
    },
    {
      icon: FolderOpen,
      title: "Bundle them into a blueprint",
      body: "A blueprint is the whole job setup: the checklists the crew runs, the paperwork it produces, the labels that file it.",
    },
    {
      icon: Rocket,
      title: "Apply it to projects",
      body: "One click on a new project or a dozen already running. Everything appears in the matching project tab, pre-filled with that project's details.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="h-4 w-4" />
              </span>
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                Step {i + 1}
              </span>
            </div>
            <h3 className="mt-3 text-sm font-bold">{s.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <EmptyState
        icon={LayoutTemplate}
        title="No project blueprints yet"
        description={
          canManage
            ? "Start from a pre-built one to see the shape of it, or build your own - then apply it to any project in a click."
            : "Ask your account owner or an admin to create one."
        }
        action={
          canManage ? (
            /* Pre-built first. A blank screen with a Create button is exactly
               the starting point the spec asks us to stop shipping, and the
               starters land a whole worked example - blueprint, checklist,
               workflow, walkthrough and report - in one press. */
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={onStarters}>
                <Rocket className="mr-1.5 h-4 w-4" />
                Start from a pre-built blueprint
              </Button>
              <Button variant="outline" onClick={onCreate}>
                <Plus className="mr-1.5 h-4 w-4" />
                Blank blueprint
              </Button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
