import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  Workflow as WorkflowIcon,
  Archive,
  ArchiveRestore,
  Copy,
  CheckSquare,
  Camera,
  StickyNote,
  ChevronDown,
  Signature,
  MoreHorizontal,
  Eye,
  Sparkles,
  ListTree,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDot,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import {
  AddTarget,
  BuilderBackToList,
  BuilderCanvas,
  BuilderLayout,
  BuilderRail,
  BuilderRailItem,
  BuilderTitleBar,
  DragHandle,
  QuietInput,
  QuietTextarea,
  RequiredToggle,
  StatChip,
} from "@/components/builder/builder-ui";
import { restrictToVerticalAxis } from "@/components/builder/builder-tokens";
import { useAutosave } from "@/components/builder/use-autosave";
import { KIND_META, KIND_ORDER, type ItemKind } from "@/lib/workflow-items";
import { GENERAL_CATEGORY, categoryIcon, makeCategoryRank } from "@/lib/template-categories";
import { TradeSelect } from "@/components/builder/TradeSelect";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { tradeCategoryFor } from "@sitepix/shared";

interface Template {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  /**
   * The trade this workflow belongs to, or null for one filed under nothing.
   *
   * Optional rather than merely nullable, same as the checklist column: a
   * database that predates 20260829000000_workflow_report_template_trades.sql
   * does not return it, and every reader treats a missing one as "General".
   */
  category?: string | null;
}
interface Phase {
  id: string;
  template_id: string;
  position: number;
  name: string;
  description: string | null;
  requires_signoff: boolean;
}
interface Item {
  id: string;
  phase_id: string;
  position: number;
  kind: ItemKind;
  label: string;
  required: boolean;
}

/**
 * Blank-canvas templates are where this builder used to lose people: you got a
 * "Phase 1" with nothing in it and no sense of what a good workflow looks like.
 * Starters mirror the checklist designer and give the crew something to shape.
 *
 * `category` is the same vocabulary as the document and checklist libraries,
 * from @/lib/template-categories, so one answer in the setup wizard orders
 * every tab. The three original starters are shapes rather than trades - an
 * install, a service call, an inspection - which is why they sit under Field
 * Reports and Field Admin; the ones below them are written for a specific
 * trade's sequence and are filed under it.
 */
const STARTER_WORKFLOWS: {
  name: string;
  description: string;
  /** A category from CATEGORY_ORDER, or undefined for a genuinely general one. */
  category?: string;
  phases: {
    name: string;
    description?: string;
    requires_signoff?: boolean;
    items: { kind: ItemKind; label: string; required?: boolean }[];
  }[];
}[] = [
  {
    name: "Install job",
    category: "Field Admin",
    description: "Pre-job walkthrough through customer handover, with sign-off at each gate.",
    phases: [
      {
        name: "Pre-job",
        description: "Confirm scope and site conditions before anything comes off the truck.",
        items: [
          { kind: "check", label: "Scope confirmed with customer", required: true },
          { kind: "photo", label: "Site condition - wide shot", required: true },
          { kind: "check", label: "Access and parking arranged" },
          { kind: "note", label: "Existing damage noted" },
        ],
      },
      {
        name: "Install",
        items: [
          { kind: "check", label: "Equipment set and secured", required: true },
          { kind: "photo", label: "Rough-in progress", required: true },
          { kind: "check", label: "Connections torqued to spec", required: true },
          { kind: "photo", label: "Nameplate / serial number", required: true },
        ],
      },
      {
        name: "Inspection",
        requires_signoff: true,
        description: "Verify the work before the customer sees it.",
        items: [
          { kind: "check", label: "Leak / pressure test passed", required: true },
          { kind: "check", label: "System cycled and operating", required: true },
          { kind: "note", label: "Readings recorded" },
        ],
      },
      {
        name: "Handover",
        requires_signoff: true,
        items: [
          { kind: "photo", label: "Completed install", required: true },
          { kind: "check", label: "Customer walkthrough completed", required: true },
          { kind: "check", label: "Site cleaned up", required: true },
          { kind: "note", label: "Follow-up needed?" },
        ],
      },
    ],
  },
  {
    name: "Service call",
    category: "Field Admin",
    description: "A single-visit troubleshoot-and-repair loop.",
    phases: [
      {
        name: "Arrival",
        items: [
          { kind: "check", label: "Arrived on site", required: true },
          { kind: "photo", label: "Equipment as found", required: true },
          { kind: "note", label: "Customer-reported symptoms", required: true },
        ],
      },
      {
        name: "Diagnose",
        items: [
          { kind: "note", label: "Fault found", required: true },
          { kind: "photo", label: "Failed component" },
          { kind: "check", label: "Estimate approved by customer", required: true },
        ],
      },
      {
        name: "Repair & close",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Repair completed", required: true },
          { kind: "photo", label: "After repair", required: true },
          { kind: "check", label: "Tested under load", required: true },
          { kind: "note", label: "Parts used" },
        ],
      },
    ],
  },
  {
    name: "Inspection & report",
    category: "Field Reports",
    description: "Walk the site, document each area, hand over a signed report.",
    phases: [
      {
        name: "Exterior",
        items: [
          { kind: "photo", label: "Front elevation", required: true },
          { kind: "photo", label: "Roof / gutters", required: true },
          { kind: "check", label: "Drainage clear" },
          { kind: "note", label: "Exterior observations" },
        ],
      },
      {
        name: "Interior",
        items: [
          { kind: "photo", label: "Each affected room", required: true },
          { kind: "check", label: "Moisture readings taken", required: true },
          { kind: "note", label: "Interior observations" },
        ],
      },
      {
        name: "Report",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Findings summarised", required: true },
          { kind: "check", label: "Recommendations listed", required: true },
          { kind: "note", label: "Next steps agreed with customer" },
        ],
      },
    ],
  },
  {
    name: "Electrical fit-out",
    category: "Electrical",
    description: "Rough-in, inspection hold point, then trim out and energise.",
    phases: [
      {
        name: "Rough-in",
        description: "Everything that has to be right before it disappears behind a wall.",
        items: [
          { kind: "check", label: "Circuit layout matches drawings", required: true },
          { kind: "check", label: "Boxes set to finished wall depth", required: true },
          { kind: "check", label: "Cable secured and protected", required: true },
          { kind: "photo", label: "Open walls before close-up", required: true },
          { kind: "note", label: "Deviations from drawings" },
        ],
      },
      {
        name: "Inspection hold",
        description: "Nothing gets covered until this passes.",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Rough-in inspection booked", required: true },
          { kind: "check", label: "Inspection passed", required: true },
          { kind: "photo", label: "Inspection notice or sticker" },
          { kind: "note", label: "Corrections required" },
        ],
      },
      {
        name: "Trim out",
        items: [
          { kind: "check", label: "Devices and plates fitted", required: true },
          { kind: "check", label: "Terminations torqued to spec", required: true },
          { kind: "check", label: "Panel schedule filled in", required: true },
          { kind: "photo", label: "Finished panel", required: true },
        ],
      },
      {
        name: "Energise & hand over",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Insulation resistance test passed", required: true },
          { kind: "check", label: "RCD / GFCI trip tests passed", required: true },
          { kind: "check", label: "Every circuit energised and proved", required: true },
          { kind: "check", label: "Certificate issued to customer", required: true },
          { kind: "note", label: "Handover notes" },
        ],
      },
    ],
  },
  {
    name: "HVAC install & commission",
    category: "HVAC",
    description: "Set the equipment, prove the refrigerant side, commission and hand over.",
    phases: [
      {
        name: "Set equipment",
        items: [
          { kind: "check", label: "Old unit removed and disposed of", required: true },
          { kind: "check", label: "Pad or hangers level and secure", required: true },
          { kind: "photo", label: "Unit in position", required: true },
          { kind: "check", label: "Clearances meet manufacturer spec", required: true },
        ],
      },
      {
        name: "Connections",
        items: [
          { kind: "check", label: "Line set brazed under nitrogen", required: true },
          { kind: "check", label: "Pressure test held", required: true },
          { kind: "check", label: "System evacuated to spec", required: true },
          { kind: "check", label: "Condensate routed and trapped", required: true },
          { kind: "photo", label: "Line set and electrical connections" },
        ],
      },
      {
        name: "Commission",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Charge weighed in and verified", required: true },
          { kind: "check", label: "Supply and return temps recorded", required: true },
          { kind: "check", label: "Static pressure within range", required: true },
          { kind: "check", label: "Thermostat programmed", required: true },
          { kind: "note", label: "Commissioning readings" },
        ],
      },
      {
        name: "Hand over",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Customer shown controls and filter change", required: true },
          { kind: "check", label: "Warranty registered", required: true },
          { kind: "photo", label: "Finished installation", required: true },
          { kind: "note", label: "Follow-up or service plan agreed" },
        ],
      },
    ],
  },
  {
    name: "Plumbing rough-in to final",
    category: "Plumbing",
    description: "Rough-in, pressure test, fixture set, and a final that actually holds.",
    phases: [
      {
        name: "Rough-in",
        items: [
          { kind: "check", label: "Supply and waste routed to drawings", required: true },
          { kind: "check", label: "Falls and venting correct", required: true },
          { kind: "check", label: "Pipe supported and protected", required: true },
          { kind: "photo", label: "Open walls and floor before close-up", required: true },
        ],
      },
      {
        name: "Pressure test",
        requires_signoff: true,
        items: [
          { kind: "check", label: "System pressurised to spec", required: true },
          { kind: "check", label: "Held for the required period", required: true },
          { kind: "photo", label: "Gauge reading at start and end", required: true },
          { kind: "note", label: "Leaks found and corrected" },
        ],
      },
      {
        name: "Fixture set",
        items: [
          { kind: "check", label: "Fixtures set level and sealed", required: true },
          { kind: "check", label: "Shut-offs fitted and operating", required: true },
          { kind: "check", label: "Traps and tailpieces correct", required: true },
          { kind: "photo", label: "Each fixture installed" },
        ],
      },
      {
        name: "Final",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Every fixture run and checked for leaks", required: true },
          { kind: "check", label: "Hot water temperature verified", required: true },
          { kind: "check", label: "Work area cleaned", required: true },
          { kind: "note", label: "Customer walkthrough notes" },
        ],
      },
    ],
  },
  {
    name: "Construction phase handover",
    category: "Construction",
    description: "Pre-construction record, in-progress evidence, punch list, then keys.",
    phases: [
      {
        name: "Pre-construction",
        items: [
          { kind: "check", label: "Existing conditions photographed", required: true },
          { kind: "photo", label: "Neighbouring property condition", required: true },
          { kind: "check", label: "Utilities located and marked", required: true },
          { kind: "check", label: "Site set up, fenced and signed", required: true },
        ],
      },
      {
        name: "In progress",
        items: [
          { kind: "photo", label: "Work claimed this period", required: true },
          { kind: "check", label: "Inspections booked and passed", required: true },
          { kind: "note", label: "Delays, RFIs and what is being done" },
        ],
      },
      {
        name: "Punch list",
        requires_signoff: true,
        items: [
          { kind: "check", label: "All trades walked their own scope", required: true },
          { kind: "photo", label: "Outstanding items", required: true },
          { kind: "check", label: "Items blocking handover closed", required: true },
          { kind: "note", label: "Open items and who owns them" },
        ],
      },
      {
        name: "Handover",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Certificates, manuals and as-builts issued", required: true },
          { kind: "check", label: "Keys and access codes transferred", required: true },
          { kind: "check", label: "Client walked the property", required: true },
          { kind: "note", label: "Warranty period and contact" },
        ],
      },
    ],
  },
  {
    name: "Tenancy turnover",
    category: "Real Estate",
    description: "Move-out, make-ready, re-let: the evidence trail a deposit dispute needs.",
    phases: [
      {
        name: "Move-out inspection",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Meters read and recorded", required: true },
          { kind: "check", label: "Keys and fobs returned", required: true },
          { kind: "photo", label: "Every room, condition on exit", required: true },
          { kind: "note", label: "Damage beyond fair wear and tear" },
        ],
      },
      {
        name: "Make ready",
        items: [
          { kind: "check", label: "Repairs completed", required: true },
          { kind: "check", label: "Property professionally cleaned", required: true },
          { kind: "check", label: "Smoke and CO alarms tested", required: true },
          { kind: "photo", label: "Each room ready to let", required: true },
        ],
      },
      {
        name: "Re-let",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Marketing photos taken", required: true },
          { kind: "check", label: "Listing published", required: true },
          { kind: "check", label: "Move-in inspection booked", required: true },
          { kind: "note", label: "New tenancy details" },
        ],
      },
    ],
  },
  {
    name: "Recurring clean",
    category: "Cleaning",
    description: "Arrival, the round, then the proof photos a client can be invoiced on.",
    phases: [
      {
        name: "Arrival",
        items: [
          { kind: "check", label: "Site access confirmed", required: true },
          { kind: "photo", label: "Before, each main area", required: true },
          { kind: "check", label: "Any damage on arrival noted", required: true },
        ],
      },
      {
        name: "The round",
        items: [
          { kind: "check", label: "Kitchen and appliances", required: true },
          { kind: "check", label: "Bathrooms and sanitaryware", required: true },
          { kind: "check", label: "Floors and surfaces", required: true },
          { kind: "check", label: "Waste removed and bins relined", required: true },
          { kind: "check", label: "Consumables restocked" },
          { kind: "note", label: "Areas skipped, and why" },
        ],
      },
      {
        name: "Sign off",
        requires_signoff: true,
        items: [
          { kind: "photo", label: "After, each main area", required: true },
          { kind: "check", label: "Client walked the work" },
          { kind: "note", label: "Anything to flag for next visit" },
        ],
      },
    ],
  },
  {
    name: "Water damage mitigation",
    category: "Restoration",
    description: "Emergency response, drying, daily readings, then a clearance you can bill on.",
    phases: [
      {
        name: "Emergency response",
        items: [
          { kind: "check", label: "Source of water stopped", required: true },
          { kind: "check", label: "Category and class determined", required: true },
          { kind: "photo", label: "Affected areas on arrival", required: true },
          { kind: "check", label: "Standing water extracted", required: true },
          { kind: "note", label: "Cause of loss" },
        ],
      },
      {
        name: "Set up drying",
        items: [
          { kind: "check", label: "Non-salvageable material removed", required: true },
          { kind: "check", label: "Air movers and dehumidifiers placed", required: true },
          { kind: "check", label: "Containment set where required" },
          { kind: "photo", label: "Equipment in position", required: true },
        ],
      },
      {
        name: "Daily monitoring",
        items: [
          { kind: "check", label: "Moisture readings taken", required: true },
          { kind: "check", label: "Equipment checked and adjusted", required: true },
          { kind: "note", label: "Readings and drying progress" },
        ],
      },
      {
        name: "Clearance",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Dry standard met on every material", required: true },
          { kind: "check", label: "Equipment removed", required: true },
          { kind: "photo", label: "Final condition", required: true },
          { kind: "check", label: "Customer signed off on completion", required: true },
        ],
      },
    ],
  },
  {
    name: "Roof replacement",
    category: "Roofing & Exterior",
    description: "Tear-off through final inspection, with the deck photos a warranty needs.",
    phases: [
      {
        name: "Tear-off",
        items: [
          { kind: "photo", label: "Roof before work", required: true },
          { kind: "check", label: "Property and landscaping protected", required: true },
          { kind: "check", label: "Old covering removed", required: true },
          { kind: "photo", label: "Deck exposed", required: true },
        ],
      },
      {
        name: "Deck & underlayment",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Damaged decking replaced", required: true },
          { kind: "check", label: "Ice and water shield fitted where required", required: true },
          { kind: "check", label: "Underlayment laid to spec", required: true },
          { kind: "photo", label: "Underlayment before covering", required: true },
          { kind: "note", label: "Decking replaced, and how much" },
        ],
      },
      {
        name: "Covering & flashing",
        items: [
          { kind: "check", label: "Covering installed to manufacturer spec", required: true },
          { kind: "check", label: "Flashings and penetrations sealed", required: true },
          { kind: "check", label: "Ridge and ventilation fitted", required: true },
          { kind: "photo", label: "Completed roof", required: true },
        ],
      },
      {
        name: "Final",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Gutters cleared and site magnet-swept", required: true },
          { kind: "check", label: "Final inspection passed", required: true },
          { kind: "check", label: "Warranty issued to customer", required: true },
          { kind: "note", label: "Handover notes" },
        ],
      },
    ],
  },
  {
    name: "Claim from first notice to estimate",
    category: "Insurance & Adjusting",
    description: "First contact, site documentation, scope, then the estimate the carrier gets.",
    phases: [
      {
        name: "First notice",
        items: [
          { kind: "check", label: "Policyholder contacted", required: true },
          { kind: "check", label: "Coverage confirmed", required: true },
          { kind: "check", label: "Site visit scheduled", required: true },
          { kind: "note", label: "Reported cause of loss" },
        ],
      },
      {
        name: "Site documentation",
        items: [
          { kind: "photo", label: "Overview of each affected area", required: true },
          { kind: "photo", label: "Close-ups of the damage", required: true },
          { kind: "check", label: "Measurements taken", required: true },
          { kind: "check", label: "Cause of loss confirmed on site", required: true },
          { kind: "note", label: "Observations and pre-existing damage" },
        ],
      },
      {
        name: "Scope",
        items: [
          { kind: "check", label: "Line-item scope written", required: true },
          { kind: "check", label: "Contents inventory taken" },
          { kind: "check", label: "Emergency mitigation documented" },
          { kind: "note", label: "Items in dispute" },
        ],
      },
      {
        name: "Estimate & submit",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Estimate prepared", required: true },
          { kind: "check", label: "Policyholder walked through it", required: true },
          { kind: "check", label: "Submitted to carrier", required: true },
          { kind: "note", label: "Next steps and review date" },
        ],
      },
    ],
  },
];

const TABLES = {
  templates: "workflow_templates",
  phases: "workflow_template_phases",
  items: "workflow_template_items",
} as const;

export function WorkflowTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [pane, setPane] = useState<"list" | "editor">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [startersOpen, setStartersOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** Row to focus after an insert, so adding a step drops you straight into it. */
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  /*
   * The company's trade, from the account setup wizard. Orders the rail and the
   * Starters dialog, so this tab answers the same question the Documents and
   * Checklists tabs do.
   */
  const { profile: company } = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.industry, company.trades),
    [company.industry, company.trades],
  );
  const ownTrade = tradeCategoryFor(company.industry);
  const [focusPhaseId, setFocusPhaseId] = useState<string | null>(null);

  const save = useAutosave(
    (table, id, patch) =>
      supabase
        .from(table as any)
        .update(patch)
        .eq("id", id)
        .then((r: any) => {
          if (r.error) throw r.error;
        }),
    { onError: (e: any) => toast.error(e?.message ?? "Couldn't save that change") },
  );

  const load = async () => {
    setLoading(true);
    const { data: tpls } = await supabase
      .from(TABLES.templates as any)
      .select("id, name, description, archived, created_at, category")
      .order("created_at", { ascending: true });
    const list = ((tpls as any[]) ?? []) as Template[];
    setTemplates(list);
    if (list.length) {
      const ids = list.map((t) => t.id);
      const { data: phs } = await supabase
        .from(TABLES.phases as any)
        .select("id, template_id, position, name, description, requires_signoff")
        .in("template_id", ids)
        .order("position", { ascending: true });
      const phList = ((phs as any[]) ?? []) as Phase[];
      setPhases(phList);
      if (phList.length) {
        const phIds = phList.map((p) => p.id);
        const { data: its } = await supabase
          .from(TABLES.items as any)
          .select("id, phase_id, position, kind, label, required")
          .in("phase_id", phIds)
          .order("position", { ascending: true });
        setItems(((its as any[]) ?? []) as Item[]);
      } else {
        setItems([]);
      }
      setSelectedId((cur) =>
        cur && list.some((t) => t.id === cur)
          ? cur
          : (list.find((t) => !t.archived)?.id ?? list[0]?.id ?? null),
      );
    } else {
      setPhases([]);
      setItems([]);
      setSelectedId(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates
      .filter((t) => showArchived || !t.archived)
      .filter(
        (t) =>
          !q || t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q),
      );
  }, [templates, showArchived, search]);

  /*
   * The rail, split by trade. Same shape and the same ordering function as the
   * Documents and Checklists tabs, so a company that told us their trade sees
   * it first here too. General leads because that is where a workflow written
   * before trades existed sits, and it is the team's own work.
   */
  const railSections = useMemo<Array<[string, Template[]]>>(() => {
    const byTrade = new Map<string, Template[]>();
    for (const t of visibleTemplates) {
      const key = t.category || GENERAL_CATEGORY;
      const list = byTrade.get(key);
      if (list) list.push(t);
      else byTrade.set(key, [t]);
    }
    return [...byTrade.entries()].sort(
      (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
    );
  }, [visibleTemplates, rank]);

  /**
   * The starter library, their trade first.
   *
   * An uncategorised starter sorts last rather than through `rank`, which puts
   * General at the very top: correct in the rail, where General is the team's
   * own work, and backwards here, where it would push a trade-less starter
   * above the one written for their trade.
   */
  const starterOrder = useMemo(
    () =>
      [...STARTER_WORKFLOWS].sort(
        (a, b) =>
          (a.category ? rank(a.category) : Number.MAX_SAFE_INTEGER) -
            (b.category ? rank(b.category) : Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name),
      ),
    [rank],
  );

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedPhases = useMemo(
    () =>
      phases.filter((p) => p.template_id === selectedId).sort((a, b) => a.position - b.position),
    [phases, selectedId],
  );
  const itemsByPhase = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) {
      const bucket = map.get(it.phase_id);
      if (bucket) bucket.push(it);
      else map.set(it.phase_id, [it]);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.position - b.position);
    return map;
  }, [items]);

  const countsFor = (templateId: string) => {
    const ph = phases.filter((p) => p.template_id === templateId);
    const ids = new Set(ph.map((p) => p.id));
    const its = items.filter((i) => ids.has(i.phase_id));
    return {
      phases: ph.length,
      items: its.length,
      required: its.filter((i) => i.required).length,
      signoffs: ph.filter((p) => p.requires_signoff).length,
    };
  };
  const stats = selected
    ? countsFor(selected.id)
    : { phases: 0, items: 0, required: 0, signoffs: 0 };

  /* ---------------------------------------------------------- templates */

  const selectTemplate = async (id: string) => {
    await save.flush();
    setSelectedId(id);
    setPane("editor");
  };

  const createTemplate = async (
    name: string,
    description: string | null,
    category?: string | null,
  ): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from(TABLES.templates as any)
      .insert({
        created_by: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        category: category ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create workflow");
      return null;
    }
    return (data as any).id as string;
  };

  const submitCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const id = await createTemplate(newName, newDesc);
    setCreating(false);
    if (!id) return;
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    setSelectedId(id);
    setPane("editor");
    await load();
    // A brand-new workflow is an empty canvas - give it a first phase so there
    // is somewhere to type instead of one lonely "Add phase" button.
    await addPhaseTo(id, 0, "Phase 1");
  };

  const createFromStarter = async (starter: (typeof STARTER_WORKFLOWS)[number]) => {
    setCreating(true);
    try {
      // The starter's trade travels with it, so the copy lands under the right
      // heading instead of in General for the author to refile by hand.
      const id = await createTemplate(starter.name, starter.description, starter.category ?? null);
      if (!id) return;
      /*
       * Both inserts below used to discard their error, and a dropped phase
       * `continue`d in silence - so a starter could land as empty shells under
       * an unconditional "Created" toast, and the author would go on to build
       * real jobs on top of it. Stop at the first failure and say so.
       */
      let failure: string | null = null;
      for (const [pIdx, ph] of starter.phases.entries()) {
        const { data: phRow, error: phErr } = await supabase
          .from(TABLES.phases as any)
          .insert({
            template_id: id,
            position: pIdx,
            name: ph.name,
            description: ph.description ?? null,
            requires_signoff: !!ph.requires_signoff,
          })
          .select("id")
          .single();
        const phId = (phRow as any)?.id as string | undefined;
        if (phErr || !phId) {
          failure = phErr?.message ?? "a phase couldn't be created";
          break;
        }
        if (!ph.items.length) continue;
        const { error: itErr } = await supabase.from(TABLES.items as any).insert(
          ph.items.map((it, idx) => ({
            phase_id: phId,
            position: idx,
            kind: it.kind,
            label: it.label,
            required: !!it.required,
          })),
        );
        if (itErr) {
          failure = itErr.message ?? "a phase's steps couldn't be added";
          break;
        }
      }
      // Land the author on whatever did get built either way - a half-built
      // starter they can see and repair beats a success toast over a shell.
      if (failure) toast.error(`Created “${starter.name}”, but not completely - ${failure}`);
      else toast.success(`Created “${starter.name}”`);
      setStartersOpen(false);
      setSelectedId(id);
      setPane("editor");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const duplicateTemplate = async (t: Template) => {
    const id = await createTemplate(`${t.name} (copy)`, t.description, t.category ?? null);
    if (!id) return;
    const tPhases = phases
      .filter((p) => p.template_id === t.id)
      .sort((a, b) => a.position - b.position);
    // Same silent-partial-copy shape as `createFromStarter`: a 30-step workflow
    // could come back as phases with no steps, reported as a success.
    let failure: string | null = null;
    for (const [idx, ph] of tPhases.entries()) {
      const { data: newPh, error: phErr } = await supabase
        .from(TABLES.phases as any)
        .insert({
          template_id: id,
          position: idx,
          name: ph.name,
          description: ph.description,
          requires_signoff: ph.requires_signoff,
        })
        .select("id")
        .single();
      const newPhId = (newPh as any)?.id as string | undefined;
      if (phErr || !newPhId) {
        failure = phErr?.message ?? "a phase couldn't be copied";
        break;
      }
      const phItems = itemsByPhase.get(ph.id) ?? [];
      if (phItems.length) {
        const { error: itErr } = await supabase.from(TABLES.items as any).insert(
          phItems.map((it, i) => ({
            phase_id: newPhId,
            position: i,
            kind: it.kind,
            label: it.label,
            required: it.required,
          })),
        );
        if (itErr) {
          failure = itErr.message ?? "a phase's steps couldn't be copied";
          break;
        }
      }
    }
    if (failure) toast.error(`Duplicated “${t.name}”, but not completely - ${failure}`);
    else toast.success("Workflow duplicated");
    setSelectedId(id);
    await load();
  };

  const toggleArchived = async (t: Template) => {
    setTemplates((xs) => xs.map((x) => (x.id === t.id ? { ...x, archived: !x.archived } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.templates as any)
        .update({ archived: !t.archived })
        .eq("id", t.id),
    );
    if (!ok)
      setTemplates((xs) => xs.map((x) => (x.id === t.id ? { ...x, archived: t.archived } : x)));
    else toast.success(t.archived ? "Workflow restored" : "Workflow archived");
  };

  const deleteTemplate = async (t: Template) => {
    if (
      !(await confirm({
        title: "Delete workflow",
        description: `“${t.name}” and all of its phases and steps will be removed. Projects already running this workflow keep their copy.`,
        confirmText: "Delete workflow",
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from(TABLES.templates as any)
      .delete()
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (selectedId === t.id) {
      setSelectedId(null);
      setPane("list");
    }
    void load();
  };

  const updateTemplate = (id: string, patch: Partial<Template>) => {
    setTemplates((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    save.queueSave(TABLES.templates, id, patch as Record<string, unknown>);
  };

  /* ------------------------------------------------------------- phases */

  const addPhaseTo = async (templateId: string, position: number, name: string) => {
    const { data, error } = await supabase
      .from(TABLES.phases as any)
      .insert({ template_id: templateId, position, name })
      .select("id, template_id, position, name, description, requires_signoff")
      .single();
    if (error || !data) {
      toast.error("Couldn't add that phase");
      return null;
    }
    const phase = data as unknown as Phase;
    setPhases((xs) => [...xs, phase]);
    setCollapsed((m) => ({ ...m, [phase.id]: false }));
    setFocusPhaseId(phase.id);
    return phase;
  };

  const addPhase = async () => {
    if (!selectedId) return;
    // max+1, not `.length`. `deletePhase` doesn't renumber the survivors, so
    // deleting a middle phase and adding another handed the new one a number a
    // sibling already held, and the two then sorted arbitrarily against each
    // other. The display name still counts, because that only has to be unused
    // enough to read as a fresh phase.
    const position = selectedPhases.reduce((max, p) => Math.max(max, p.position), -1) + 1;
    await addPhaseTo(selectedId, position, `Phase ${selectedPhases.length + 1}`);
  };

  const updatePhase = (id: string, patch: Partial<Phase>) => {
    setPhases((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    save.queueSave(TABLES.phases, id, patch as Record<string, unknown>);
  };

  const deletePhase = async (ph: Phase) => {
    const count = (itemsByPhase.get(ph.id) ?? []).length;
    if (
      count > 0 &&
      !(await confirm({
        title: "Delete phase",
        description: `“${ph.name || "Untitled phase"}” and its ${count} step${count === 1 ? "" : "s"} will be removed.`,
        confirmText: "Delete phase",
        variant: "destructive",
      }))
    )
      return;
    const prevPhases = phases;
    const prevItems = items;
    setPhases((xs) => xs.filter((x) => x.id !== ph.id));
    setItems((xs) => xs.filter((x) => x.phase_id !== ph.id));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.phases as any)
        .delete()
        .eq("id", ph.id),
    );
    if (!ok) {
      setPhases(prevPhases);
      setItems(prevItems);
    }
  };

  /**
   * Push a set of rows down one slot to open a gap at source+1, locally first
   * and then on the server. Phases and steps both need this, so it is written
   * once and parameterised by table rather than open-coded twice.
   *
   * The gaps `deletePhase` / `deleteItem` leave behind can't cause a collision:
   * a displaced row at p > source lands at p+1 >= source+2, and every row that
   * isn't displaced keeps a number at or below source.
   *
   * Every result is checked, the way `reorderPhases` already does it.
   * `duplicatePhase` used to fire these bare - and since the query builder
   * resolves to `{ error }` instead of rejecting, a failed shift returned as if
   * it had worked, leaving the screen showing an order the database didn't
   * have until the next load put two rows on one number.
   */
  const shiftDown = async <T extends { id: string; position: number }>(
    table: string,
    displaced: T[],
    setter: (updater: (xs: T[]) => T[]) => void,
  ) => {
    if (!displaced.length) return;
    const ids = new Set(displaced.map((d) => d.id));
    setter((xs) => xs.map((x) => (ids.has(x.id) ? { ...x, position: x.position + 1 } : x)));
    const ok = await save.runImmediate(async () => {
      const results = await Promise.all(
        displaced.map((d) =>
          supabase
            .from(table as any)
            .update({ position: d.position + 1 })
            .eq("id", d.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
    // Refetch rather than roll back: these are independent requests, so a
    // failure can be partial and no local undo is right for both halves.
    if (!ok) {
      // Flush first - `load()` replaces state from the database but leaves the
      // autosave queue holding its pending patch, which then lands afterwards
      // with no re-render, so a label mid-edit would vanish and still be saved.
      await save.flush();
      await load();
    }
  };

  const duplicatePhase = async (ph: Phase) => {
    if (!selectedId) return;
    const position = ph.position + 1;
    const displaced = selectedPhases.filter((p) => p.position > ph.position);
    const { data, error } = await supabase
      .from(TABLES.phases as any)
      .insert({
        template_id: selectedId,
        position,
        name: `${ph.name} (copy)`,
        description: ph.description,
        requires_signoff: ph.requires_signoff,
      })
      .select("id, template_id, position, name, description, requires_signoff")
      .single();
    if (error || !data) {
      toast.error("Couldn't duplicate that phase");
      return;
    }
    const newPhase = data as unknown as Phase;
    const source = itemsByPhase.get(ph.id) ?? [];
    let newItems: Item[] = [];
    if (source.length) {
      // The last silent write in this file: a refused copy left an empty
      // "(copy)" phase with no toast at all, so the author assumed the steps
      // were still loading and built real jobs on a template that has none.
      const { data: its, error: itsErr } = await supabase
        .from(TABLES.items as any)
        .insert(
          source.map((it, i) => ({
            phase_id: newPhase.id,
            position: i,
            kind: it.kind,
            label: it.label,
            required: it.required,
          })),
        )
        .select("id, phase_id, position, kind, label, required");
      if (itsErr) {
        toast.error(itsErr.message ?? "Couldn't copy that phase's steps");
        await load();
        return;
      }
      newItems = ((its as any[]) ?? []) as Item[];
    }
    setPhases((xs) => [...xs, newPhase]);
    setItems((xs) => [...xs, ...newItems]);
    // Push everything after the source phase down one slot.
    await shiftDown(TABLES.phases, displaced, setPhases);
  };

  const reorderPhases = async (from: number, to: number) => {
    const reordered = arrayMove(selectedPhases, from, to);
    setPhases((xs) => {
      const others = xs.filter((x) => x.template_id !== selectedId);
      return [...others, ...reordered.map((p, idx) => ({ ...p, position: idx }))];
    });
    const ok = await save.runImmediate(async () => {
      const results = await Promise.all(
        reordered.map((p, idx) =>
          supabase
            .from(TABLES.phases as any)
            .update({ position: idx })
            .eq("id", p.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
    // `runImmediate` returns a boolean precisely so callers can reconcile.
    // Discarding it left the list showing the new order after a failed write,
    // and every later load snapped it back with no explanation.
    if (!ok) {
      await save.flush();
      await load();
    }
  };

  /* -------------------------------------------------------------- items */

  const addItem = async (phaseId: string, kind: ItemKind, after?: Item) => {
    const siblings = itemsByPhase.get(phaseId) ?? [];
    /*
     * Appends by default; `after` drops the new step directly below a specific
     * one, which is the only thing Enter on a mid-list step can honestly mean.
     * This used to append unconditionally, so Enter on step 3 of 20 built step
     * 21 and then dragged the caret down there with it.
     *
     * The append case is max+1 rather than `.length` for the same reason
     * `addPhase` is: `deleteItem` doesn't renumber, so length reused a number a
     * sibling already held.
     */
    const displaced = after ? siblings.filter((i) => i.position > after.position) : [];
    const position = after
      ? after.position + 1
      : siblings.reduce((max, i) => Math.max(max, i.position), -1) + 1;
    const { data, error } = await supabase
      .from(TABLES.items as any)
      .insert({ phase_id: phaseId, position, kind, label: "", required: false })
      .select("id, phase_id, position, kind, label, required")
      .single();
    if (error || !data) {
      toast.error("Couldn't add that step");
      return;
    }
    const item = data as unknown as Item;
    setItems((xs) => [...xs, item]);
    setFocusItemId(item.id);
    // Not awaited: the order is already right locally, and making the caret
    // wait on one round trip per displaced step would buy nothing.
    void shiftDown(TABLES.items, displaced, setItems);
  };

  const updateItem = (id: string, patch: Partial<Item>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    save.queueSave(TABLES.items, id, patch as Record<string, unknown>);
  };

  const deleteItem = async (id: string) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.items as any)
        .delete()
        .eq("id", id),
    );
    if (!ok) setItems(prev);
  };

  const reorderItems = async (phaseId: string, from: number, to: number) => {
    const list = itemsByPhase.get(phaseId) ?? [];
    const reordered = arrayMove(list, from, to);
    setItems((xs) => {
      const others = xs.filter((x) => x.phase_id !== phaseId);
      return [...others, ...reordered.map((it, idx) => ({ ...it, position: idx }))];
    });
    const ok = await save.runImmediate(async () => {
      const results = await Promise.all(
        reordered.map((it, idx) =>
          supabase
            .from(TABLES.items as any)
            .update({ position: idx })
            .eq("id", it.id),
        ),
      );
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
    });
    if (!ok) {
      await save.flush();
      await load();
    }
  };

  /* ---------------------------------------------------------------- dnd */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const a = active.data.current as { type?: string; phaseId?: string } | undefined;
    const o = over.data.current as { type?: string; phaseId?: string } | undefined;
    if (a?.type === "phase") {
      // An expanded phase is mostly steps, so the nearest droppable under the
      // cursor is usually one of its rows. Resolve that back to its phase
      // instead of dropping the gesture on the floor.
      const overPhaseId = o?.type === "phase" ? String(over.id) : o?.phaseId;
      if (!overPhaseId || overPhaseId === active.id) return;
      const from = selectedPhases.findIndex((p) => p.id === active.id);
      const to = selectedPhases.findIndex((p) => p.id === overPhaseId);
      if (from >= 0 && to >= 0) void reorderPhases(from, to);
      return;
    }
    if (a?.type === "item" && o?.type === "item" && a.phaseId && a.phaseId === o.phaseId) {
      const list = itemsByPhase.get(a.phaseId) ?? [];
      const from = list.findIndex((i) => i.id === active.id);
      const to = list.findIndex((i) => i.id === over.id);
      if (from >= 0 && to >= 0) void reorderItems(a.phaseId, from, to);
    }
  };

  /* --------------------------------------------------------------- view */

  const allCollapsed = selectedPhases.length > 0 && selectedPhases.every((p) => collapsed[p.id]);

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setStartersOpen(true)}>
        <Sparkles className="mr-1.5 h-4 w-4" />
        Starters
      </Button>
      <Button size="sm" onClick={() => setCreateOpen(true)}>
        <Plus className="mr-1.5 h-4 w-4" />
        New workflow
      </Button>
    </div>
  );

  return (
    <div className={embedded ? "" : "container mx-auto max-w-6xl px-4 pb-24 pt-4 md:pt-6"}>
      {embedded ? (
        <div className="flex justify-end">{headerActions}</div>
      ) : (
        <PageHeader
          backTo="/settings"
          backLabel="Settings"
          eyebrow="Workspace tools"
          title="Workflow templates"
          description="Phases the crew works through in order - checklist items, photo prompts, notes, and sign-off gates."
          actions={headerActions}
        />
      )}

      {loading ? (
        <Card className={cn(SURFACE_CARD, "mt-6 flex items-center justify-center p-12")}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Build a workflow once - Pre-Job, Install, Inspection, Handover - then apply it to any project. Start from a proven one or design your own."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setStartersOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Start from a template
              </Button>
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Blank workflow
              </Button>
            </div>
          }
          className="mt-6"
        />
      ) : (
        <BuilderLayout
          pane={pane}
          rail={
            <BuilderRail
              label="Workflows"
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search workflows…"
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((s) => !s)}
              footer={
                <AddTarget onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  New workflow
                </AddTarget>
              }
            >
              {visibleTemplates.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No workflows match “{search}”.
                </li>
              ) : (
                railSections.map(([heading, list]) => (
                  <Fragment key={heading}>
                    {railSections.length > 1 && (
                      <li className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[1.2px] text-muted-foreground">
                        {heading}
                        {heading === ownTrade && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                            Yours
                          </span>
                        )}
                      </li>
                    )}
                    {list.map((t) => {
                      const c = countsFor(t.id);
                      return (
                        <BuilderRailItem
                          key={t.id}
                          active={selectedId === t.id}
                          name={t.name}
                          archived={t.archived}
                          meta={`${c.phases} phase${c.phases === 1 ? "" : "s"} · ${c.items} step${c.items === 1 ? "" : "s"}`}
                          onSelect={() => void selectTemplate(t.id)}
                        />
                      );
                    })}
                  </Fragment>
                ))
              )}
            </BuilderRail>
          }
          canvas={
            selected ? (
              <>
                <BuilderBackToList label="All workflows" onClick={() => setPane("list")} />
                <BuilderCanvas>
                  <BuilderTitleBar
                    icon={<WorkflowIcon className="h-4.5 w-4.5" />}
                    title={selected.name}
                    description={selected.description ?? ""}
                    titlePlaceholder="Workflow name"
                    descriptionPlaceholder="When should the crew use this workflow?"
                    onTitleChange={(v) => updateTemplate(selected.id, { name: v })}
                    onDescriptionChange={(v) =>
                      updateTemplate(selected.id, { description: v || null })
                    }
                    saveState={save.state}
                    stats={
                      <>
                        <StatChip icon={ListTree}>
                          {stats.phases} phase{stats.phases === 1 ? "" : "s"}
                        </StatChip>
                        <StatChip icon={CircleDot}>
                          {stats.items} step{stats.items === 1 ? "" : "s"}
                        </StatChip>
                        {stats.required > 0 && (
                          <StatChip>
                            <span className="text-amber-600 dark:text-amber-400">
                              {stats.required} required
                            </span>
                          </StatChip>
                        )}
                        {stats.signoffs > 0 && (
                          <StatChip icon={Signature}>
                            {stats.signoffs} sign-off{stats.signoffs === 1 ? "" : "s"}
                          </StatChip>
                        )}
                        {/* Refiled in place, beside the other facts about the
                            workflow. Same control and same reasoning as the
                            Checklists tab. */}
                        <TradeSelect
                          value={selected.category ?? null}
                          onChange={(v) => {
                            // A menu pick, not typing, so it is written
                            // straight through rather than debounced - the
                            // rail has to re-group the moment it changes or
                            // the workflow appears to have moved nowhere.
                            setTemplates((prev) =>
                              prev.map((t) => (t.id === selected.id ? { ...t, category: v } : t)),
                            );
                            void supabase
                              .from(TABLES.templates as any)
                              .update({ category: v })
                              .eq("id", selected.id)
                              .then((r: any) => {
                                if (r.error) {
                                  toast.error(r.error.message);
                                  void load();
                                }
                              });
                          }}
                        />
                      </>
                    }
                    banner={
                      selected.archived ? (
                        <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-[11.5px] font-semibold text-muted-foreground">
                          <Archive className="h-3.5 w-3.5" />
                          Archived - it won't show up when applying a workflow to a project.
                        </div>
                      ) : null
                    }
                    actions={
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="hidden sm:inline-flex"
                          onClick={() => setPreviewOpen(true)}
                        >
                          <Eye className="mr-1.5 h-4 w-4" />
                          Preview
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Workflow actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              className="sm:hidden"
                              onClick={() => setPreviewOpen(true)}
                            >
                              <Eye className="mr-2 h-4 w-4" />
                              Preview
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void duplicateTemplate(selected)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void toggleArchived(selected)}>
                              {selected.archived ? (
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
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void deleteTemplate(selected)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete workflow
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    }
                  />

                  <div className="px-4 pb-5 pt-4 sm:px-6">
                    {selectedPhases.length > 1 && (
                      <div className="mb-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsed(
                              allCollapsed
                                ? {}
                                : Object.fromEntries(selectedPhases.map((p) => [p.id, true])),
                            )
                          }
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {allCollapsed ? (
                            <ChevronsUpDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronsDownUp className="h-3.5 w-3.5" />
                          )}
                          {allCollapsed ? "Expand all" : "Collapse all"}
                        </button>
                      </div>
                    )}

                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      modifiers={[restrictToVerticalAxis]}
                      onDragEnd={onDragEnd}
                    >
                      <SortableContext
                        items={selectedPhases.map((p) => p.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="relative space-y-2.5">
                          {/* Connector between the numbered phase badges. Cards
                              come later in the DOM and carry bg-card, so it only
                              shows through in the gaps - left-[47px] centres it
                              under the badge (10px card pad + 20px handle + 4px
                              gap + half of the 28px badge). */}
                          {selectedPhases.length > 1 && (
                            <span
                              aria-hidden
                              className="absolute bottom-6 left-[47px] top-6 w-px bg-border"
                            />
                          )}
                          {selectedPhases.map((ph, idx) => (
                            <PhaseCard
                              key={ph.id}
                              index={idx}
                              phase={ph}
                              items={itemsByPhase.get(ph.id) ?? []}
                              collapsed={!!collapsed[ph.id]}
                              autoFocus={focusPhaseId === ph.id}
                              onFocused={() => setFocusPhaseId(null)}
                              focusItemId={focusItemId}
                              onItemFocused={() => setFocusItemId(null)}
                              onToggle={() => setCollapsed((m) => ({ ...m, [ph.id]: !m[ph.id] }))}
                              onUpdate={(patch) => updatePhase(ph.id, patch)}
                              onDelete={() => void deletePhase(ph)}
                              onDuplicate={() => void duplicatePhase(ph)}
                              onAddItem={(kind, after) => void addItem(ph.id, kind, after)}
                              onUpdateItem={updateItem}
                              onDeleteItem={(id) => void deleteItem(id)}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>

                    <AddTarget className="mt-3 py-3" onClick={() => void addPhase()}>
                      <Plus className="h-4 w-4" />
                      Add phase
                    </AddTarget>
                  </div>
                </BuilderCanvas>
              </>
            ) : (
              <Card
                className={cn(
                  SURFACE_CARD,
                  "flex flex-col items-center justify-center gap-2 p-16 text-center",
                )}
              >
                <WorkflowIcon className="h-6 w-6 text-muted-foreground/70" />
                <p className="text-sm font-semibold">Select a workflow to edit</p>
              </Card>
            )
          }
        />
      )}

      {/* ---------------------------------------------------------- dialogs */}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Name it after the job type. You'll add phases and steps next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    e.preventDefault();
                    void submitCreate();
                  }
                }}
                placeholder="e.g. HVAC install"
                autoFocus
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="wf-desc">Description (optional)</Label>
              <Textarea
                id="wf-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                placeholder="When should the crew use this?"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitCreate()} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={startersOpen} onOpenChange={setStartersOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Start from a proven workflow</DialogTitle>
            <DialogDescription>
              Each one is a full set of phases and steps. Rename, reorder, or delete anything after.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-3">
            {/* Sorted, not grouped: their trade first, then the rest. Headings
                would cost more room than they save at this many cards, but
                which card is FIRST still matters. */}
            {starterOrder.map((s) => {
              const steps = s.phases.reduce((n, p) => n + p.items.length, 0);
              const TradeIcon = categoryIcon(s.category ?? GENERAL_CATEGORY);
              return (
                <Card key={s.name} className={cn(SURFACE_CARD, "flex flex-col p-4")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-lg font-bold tracking-[-0.3px]">{s.name}</div>
                    {s.category === ownTrade && (
                      <span className="mt-1 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.6px] text-primary">
                        Your trade
                      </span>
                    )}
                  </div>
                  {s.category && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                      <TradeIcon className="h-3 w-3" />
                      {s.category}
                    </div>
                  )}
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {s.description}
                  </p>
                  <ol className="mt-3 space-y-1">
                    {s.phases.map((p, i) => (
                      <li
                        key={p.name}
                        className="flex items-center gap-2 text-[11.5px] text-muted-foreground"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold">
                          {i + 1}
                        </span>
                        <span className="truncate font-semibold text-foreground/80">{p.name}</span>
                        {p.requires_signoff && (
                          <Signature className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-3 text-[11px] font-semibold text-muted-foreground">
                    {s.phases.length} phases · {steps} steps
                  </div>
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => void createFromStarter(s)}
                    disabled={creating}
                  >
                    Use this workflow
                  </Button>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Field preview</DialogTitle>
            <DialogDescription>
              How “{selected?.name}” looks to the crew on a project.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto rounded-2xl border border-border bg-muted/25 p-3">
            <WorkflowPreview phases={selectedPhases} itemsByPhase={itemsByPhase} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ====================================================================== */

function PhaseCard({
  index,
  phase,
  items,
  collapsed,
  autoFocus,
  onFocused,
  focusItemId,
  onItemFocused,
  onToggle,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: {
  index: number;
  phase: Phase;
  items: Item[];
  collapsed: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  focusItemId: string | null;
  onItemFocused: () => void;
  onToggle: () => void;
  onUpdate: (patch: Partial<Phase>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddItem: (kind: ItemKind, after?: Item) => void;
  onUpdateItem: (id: string, patch: Partial<Item>) => void;
  onDeleteItem: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: phase.id,
    data: { type: "phase" },
  });
  const nameRef = useRef<HTMLInputElement>(null);
  const [showDescription, setShowDescription] = useState(!!phase.description);

  useEffect(() => {
    if (autoFocus) {
      nameRef.current?.focus();
      nameRef.current?.select();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const required = items.filter((i) => i.required).length;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group/phase relative rounded-2xl border border-border bg-card transition-shadow",
        // The card is already `relative`, so this z-index is live - at z-30 a
        // dragged phase floated over the sticky BuilderTitleBar (z-10) and the
        // AppHeader (z-20). It only needs to clear its sibling phases.
        isDragging && "z-[5] opacity-90 shadow-[0px_18px_36px_-20px_rgba(16,25,41,0.55)]",
      )}
    >
      <div className="flex items-start gap-1 px-2.5 py-2.5">
        <DragHandle className="mt-1" {...attributes} {...listeners} />
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand phase" : "Collapse phase"}
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold transition-colors",
            collapsed
              ? "border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground"
              : "border-primary/25 bg-primary/10 text-primary",
          )}
        >
          {index + 1}
        </button>

        <div className="min-w-0 flex-1 pl-1">
          <QuietInput
            ref={nameRef}
            value={phase.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder="Phase name"
            aria-label="Phase name"
            className="text-[15px] font-bold"
          />
          {(showDescription || phase.description) && (
            <QuietTextarea
              value={phase.description ?? ""}
              onChange={(e) => onUpdate({ description: e.target.value || null })}
              placeholder="What has to be true before this phase is done?"
              aria-label="Phase description"
              className="text-xs text-muted-foreground"
            />
          )}
          {collapsed && (
            <p className="px-2 pt-0.5 text-[11.5px] font-semibold text-muted-foreground">
              {items.length} step{items.length === 1 ? "" : "s"}
              {required > 0 && ` · ${required} required`}
              {phase.requires_signoff && " · sign-off"}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate({ requires_signoff: !phase.requires_signoff })}
            aria-pressed={phase.requires_signoff}
            title={
              phase.requires_signoff
                ? "Sign-off required to close this phase"
                : "No sign-off required"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-colors",
              phase.requires_signoff
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground/70 hover:border-primary/30 hover:text-foreground",
            )}
          >
            <Signature className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign-off</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label="Phase actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setShowDescription((s) => !s)}>
                {showDescription || phase.description ? "Hide description" : "Add description"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate phase
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete phase
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand phase" : "Collapse phase"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", collapsed && "-rotate-90")}
            />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-border/70 px-2.5 py-2.5">
          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No steps yet - add the first thing the crew does in this phase.
            </p>
          ) : (
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <StepRow
                    key={it.id}
                    item={it}
                    autoFocus={focusItemId === it.id}
                    onFocused={onItemFocused}
                    onChange={(patch) => onUpdateItem(it.id, patch)}
                    onDelete={() => onDeleteItem(it.id)}
                    onAddAfter={() => onAddItem(it.kind, it)}
                  />
                ))}
              </ul>
            </SortableContext>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {KIND_ORDER.map((kind) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onAddItem(kind)}
                  title={meta.hint}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11.5px] font-bold text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/[0.04] hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <Icon className="h-3.5 w-3.5" />
                  {meta.short}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({
  item,
  autoFocus,
  onFocused,
  onChange,
  onDelete,
  onAddAfter,
}: {
  item: Item;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<Item>) => void;
  onDelete: () => void;
  onAddAfter: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "item", phaseId: item.phase_id },
  });
  const inputRef = useRef<HTMLInputElement>(null);
  // A row created by "add step" starts empty and is discarded if you walk away
  // without naming it - so the builder never accumulates blank rows.
  const removed = useRef(false);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  const meta = KIND_META[item.kind];
  const Icon = meta.icon;

  const remove = () => {
    if (removed.current) return;
    removed.current = true;
    onDelete();
  };

  /**
   * Discard a never-named row, but only once focus actually leaves it -
   * otherwise reaching for the type chip on a row you just added would delete
   * it out from under you.
   */
  const discardIfUnnamed = (e: React.FocusEvent<HTMLInputElement>) => {
    if (item.label.trim()) return;
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.closest("li")?.contains(next)) return;
    remove();
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1.5 rounded-xl border border-border bg-background/60 px-1.5 py-1.5 transition-colors hover:border-primary/30",
        // `relative`, because z-index is inert on a static box: this read
        // `z-30` and did nothing, so a dragged step was painted in plain DOM
        // order and the steps below it clipped its lift shadow. Stays under
        // BuilderTitleBar (z-10) and AppHeader (z-20).
        isDragging && "relative z-[5] opacity-90 shadow-[0px_14px_28px_-18px_rgba(16,25,41,0.55)]",
      )}
    >
      <DragHandle {...attributes} {...listeners} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={`${meta.label} - click to change`}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wide transition-opacity hover:opacity-80",
              meta.tint,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{meta.short}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Step type
          </DropdownMenuLabel>
          {KIND_ORDER.map((kind) => {
            const m = KIND_META[kind];
            const I = m.icon;
            return (
              <DropdownMenuItem key={kind} onClick={() => onChange({ kind })}>
                <I className="mr-2 h-4 w-4" />
                <span className="flex-1">
                  {m.label}
                  <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                </span>
                {item.kind === kind && <CheckSquare className="ml-2 h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <QuietInput
        ref={inputRef}
        value={item.label}
        onChange={(e) => onChange({ label: e.target.value })}
        onBlur={discardIfUnnamed}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (item.label.trim()) onAddAfter();
            else e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
          } else if (e.key === "Backspace" && !item.label) {
            e.preventDefault();
            remove();
          }
        }}
        placeholder={meta.placeholder}
        aria-label="Step label"
      />

      <RequiredToggle required={item.required} onToggle={(v) => onChange({ required: v })} />

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-60"
        onMouseDown={(e) => e.preventDefault()}
        onClick={remove}
        aria-label="Delete step"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

/**
 * Read-only rendering of the workflow as the crew meets it - the answer to
 * "what am I actually building here?" without leaving the designer.
 */
function WorkflowPreview({
  phases,
  itemsByPhase,
}: {
  phases: Phase[];
  itemsByPhase: Map<string, Item[]>;
}) {
  if (phases.length === 0)
    return (
      <p className="px-3 py-8 text-center text-sm text-muted-foreground">
        Add a phase to see the preview.
      </p>
    );
  return (
    <div className="space-y-2">
      {phases.map((ph, idx) => {
        const its = itemsByPhase.get(ph.id) ?? [];
        return (
          <div
            key={ph.id}
            className={cn(
              "rounded-2xl border bg-card",
              idx === 0 ? "border-primary/40 ring-1 ring-primary/10" : "border-border",
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="text-sm font-bold">{ph.name || "Untitled phase"}</span>
              {idx === 0 && (
                <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
                  Now
                </span>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">0 / {its.length}</span>
            </div>
            <div className="space-y-1.5 border-t border-border px-3 py-2.5">
              {ph.description && (
                <p className="pb-1 text-xs text-muted-foreground">{ph.description}</p>
              )}
              {its.length === 0 && <p className="text-xs text-muted-foreground">No steps yet.</p>}
              {its.map((it) => {
                if (it.kind === "check")
                  return (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-background/60 px-3 py-2"
                    >
                      <Checkbox checked={false} disabled aria-hidden />
                      <span className="flex-1 text-sm">{it.label || "Untitled step"}</span>
                      {it.required && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Required
                        </span>
                      )}
                    </div>
                  );
                const M = KIND_META[it.kind];
                const I = M.icon;
                return (
                  <div
                    key={it.id}
                    className="rounded-xl border border-border bg-background/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <I className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">
                        {it.label || "Untitled step"}
                      </span>
                      {it.required && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Required
                        </span>
                      )}
                    </div>
                    <div className="mt-2 rounded-lg border border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground">
                      {it.kind === "photo" ? "Take / upload photo" : "Type a note…"}
                    </div>
                  </div>
                );
              })}
              {ph.requires_signoff && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  <Signature className="h-4 w-4" />
                  Sign off when this phase is verified.
                  <span className="ml-auto rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground">
                    Sign off
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
