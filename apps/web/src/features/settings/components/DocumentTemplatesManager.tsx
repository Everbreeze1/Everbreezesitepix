import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { SectionHeading, SURFACE_BUTTON, SURFACE_CARD_INTERACTIVE } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { ProjectImage } from "@/lib/tiptap-project-image";
import { Spacer } from "@/lib/tiptap-spacer";
import { FillField, MergeToken } from "@/lib/tiptap-fill-field";
import { DocumentToolbar } from "@/features/projects/components/DocumentToolbar";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  FileText,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  Save,
  Sparkles,
  FileSignature,
  FileCheck2,
  Newspaper,
  Footprints,
  ClipboardList,
  Download,
  ChevronDown,
  ArrowLeft,
  Check,
  LayoutTemplate,
  FilePlus2,
  PanelRightOpen,
  PanelRightClose,
  MoreHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getDocumentTemplate } from "@/lib/project-pages.functions";
import { UseTemplateDialog } from "@/features/projects/components/UseTemplateDialog";
import {
  CATEGORY_ORDER,
  GENERAL_CATEGORY,
  categoryIcon,
  makeCategoryRank,
} from "@/lib/template-categories";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { nextCopyName } from "@/lib/duplicate-name";
import { tradeCategoryFor } from "@sitepix/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
/**
 * The starting layouts "New template" offers.
 *
 * Rows written before a given rewrite can hold a style this union has dropped
 * ("sitelog_basic" and friends, which were the three sample-site-log bodies).
 * Nothing breaks: `parseBody` casts whatever is stored, and every lookup here
 * falls back to `STYLE_PRESETS[0]`.
 */
type DocStyle = "report" | "letter" | "checklist" | "memo" | "walkthrough" | "sitelog";

interface DocumentTemplate {
  id: string;
  team_id: string | null;
  created_by: string;
  name: string;
  body: any;
  fields: string[];
  archived: boolean;
  created_at: string;
  updated_at: string;
}

interface DocBody {
  style: DocStyle;
  html: string;
  description?: string;
  /**
   * The trade this document belongs to - "HVAC", "Plumbing", and the rest of
   * @/lib/template-categories. Built-ins are seeded with one; a team's own
   * template has one only if its author picked a trade, and reads as General
   * until they do.
   */
  category?: string;
  /**
   * The built-in this row is the company's version of, by id.
   *
   * Set when Edit is pressed on an example: those are shared with every company
   * and RLS refuses the write, so editing one has to produce a row of the team's
   * own. Recording which built-in it replaces is what keeps that from being
   * visible as duplication - `shadowedExamples` hides the example behind it, so
   * the library holds one card for the document either way.
   *
   * Stored in `body` rather than a column of its own: `body` is jsonb, so this
   * needed no migration, and nothing outside the two places that read it has to
   * know the key exists.
   */
  copiedFrom?: string;
}

/** The editor dialog's working copy, before it is written back to the row. */
interface EditorState {
  template: DocumentTemplate | null;
  name: string;
  body: DocBody;
  /**
   * This row was created by "Make an editable copy" for the edit currently on
   * screen, and has never been saved.
   *
   * A copy that is closed without a save is deleted again rather than left in
   * the grid - see `closeEditor`. Every stray "(copy)" card the client reported
   * arrived the same way: the old Duplicate button inserted a byte-identical row
   * and toasted, so a click made out of curiosity left a permanent card behind.
   */
  fresh?: boolean;
}

interface Props {
  teamId: string | null;
  canManage: boolean;
}

// ---------------------------------------------------------------------------
// Placeholders + style presets
// ---------------------------------------------------------------------------
const PLACEHOLDERS: { token: string; label: string; group: string }[] = [
  { token: "project_name", label: "Project name", group: "Project" },
  { token: "project_address", label: "Project address", group: "Project" },
  { token: "project_number", label: "Project number", group: "Project" },
  { token: "client_name", label: "Client name", group: "Project" },
  { token: "client_contact", label: "Client contact", group: "Project" },
  { token: "date", label: "Today's date", group: "General" },
  { token: "prepared_by", label: "Prepared by", group: "General" },
  // Labels match apps/api/.../pages.ts PLACEHOLDER_LABELS: the same field is
  // named to the author here and to the reader in the document itself.
  { token: "prepared_by_title", label: "Job title", group: "General" },
  { token: "weather", label: "Weather", group: "General" },
  { token: "company_name", label: "Company name", group: "Company" },
  { token: "company_address", label: "Company address", group: "Company" },
  { token: "company_phone", label: "Company phone", group: "Company" },
];
type Placeholder = (typeof PLACEHOLDERS)[number];

// Relevant placeholder tokens per template style, in preferred order.
const RELEVANT_BY_STYLE: Record<string, string[]> = {
  report: [
    "project_name",
    "project_address",
    "date",
    "prepared_by",
    "prepared_by_title",
    "company_name",
  ],
  letter: [
    "date",
    "client_name",
    "client_contact",
    "project_address",
    "project_name",
    "prepared_by",
    "prepared_by_title",
    "company_name",
  ],
  checklist: ["project_name", "date", "prepared_by"],
  memo: ["date", "client_name", "prepared_by", "project_name", "company_name"],
  walkthrough: [
    "project_name",
    "project_address",
    "date",
    "weather",
    "prepared_by",
    "prepared_by_title",
    "client_name",
  ],
  sitelog: [
    "project_name",
    "project_address",
    "project_number",
    "date",
    "weather",
    "prepared_by",
    "prepared_by_title",
    "company_name",
  ],
};

function getRelevantPlaceholders(style: string, detected: string[]): Placeholder[] {
  const preferred = RELEVANT_BY_STYLE[style] ?? RELEVANT_BY_STYLE.report;
  const merged = Array.from(new Set([...(detected ?? []), ...preferred]));
  return merged
    .map((t) => PLACEHOLDERS.find((p) => p.token === t))
    .filter((p): p is Placeholder => Boolean(p));
}

/*
 * Photo slots, byte-identical to the ones the seeded library ships (see
 * supabase/migrations/*_document_templates_*_seed.sql).
 *
 * `isPhotoSlot` in the project page editor keys off the `data:image/svg+xml`
 * src, so a slot written here is the same tap-to-fill target as a slot that
 * came out of SQL. Written out in full rather than built by a helper because
 * tests/document-template-library.test.ts reads these bodies out of this file
 * as text, and a function call is not something it can evaluate.
 */
const PHOTO_SLOT =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'240'%20height%3D'260'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'239'%20height%3D'259'%20rx%3D'8'%20fill%3D'rgb(246%2C247%2C249)'%20stroke%3D'rgb(199%2C205%2C214)'%20stroke-dasharray%3D'6%205'%2F%3E%3Ctext%20x%3D'120'%20y%3D'124'%20font-family%3D'sans-serif'%20font-size%3D'13'%20font-weight%3D'700'%20fill%3D'rgb(100%2C108%2C124)'%20text-anchor%3D'middle'%3EPhoto%3C%2Ftext%3E%3Ctext%20x%3D'120'%20y%3D'144'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(150%2C158%2C172)'%20text-anchor%3D'middle'%3ETap%20to%20add%20photo%3C%2Ftext%3E%3C%2Fsvg%3E";
const PHOTO_SLOT_BEFORE =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'240'%20height%3D'260'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'239'%20height%3D'259'%20rx%3D'8'%20fill%3D'rgb(246%2C247%2C249)'%20stroke%3D'rgb(199%2C205%2C214)'%20stroke-dasharray%3D'6%205'%2F%3E%3Ctext%20x%3D'120'%20y%3D'124'%20font-family%3D'sans-serif'%20font-size%3D'13'%20font-weight%3D'700'%20fill%3D'rgb(100%2C108%2C124)'%20text-anchor%3D'middle'%3EBefore%3C%2Ftext%3E%3Ctext%20x%3D'120'%20y%3D'144'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(150%2C158%2C172)'%20text-anchor%3D'middle'%3ETap%20to%20add%20photo%3C%2Ftext%3E%3C%2Fsvg%3E";
const PHOTO_SLOT_AFTER =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'240'%20height%3D'260'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'239'%20height%3D'259'%20rx%3D'8'%20fill%3D'rgb(246%2C247%2C249)'%20stroke%3D'rgb(199%2C205%2C214)'%20stroke-dasharray%3D'6%205'%2F%3E%3Ctext%20x%3D'120'%20y%3D'124'%20font-family%3D'sans-serif'%20font-size%3D'13'%20font-weight%3D'700'%20fill%3D'rgb(100%2C108%2C124)'%20text-anchor%3D'middle'%3EAfter%3C%2Ftext%3E%3Ctext%20x%3D'120'%20y%3D'144'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(150%2C158%2C172)'%20text-anchor%3D'middle'%3ETap%20to%20add%20photo%3C%2Ftext%3E%3C%2Fsvg%3E";
const PHOTO_SLOT_WIDE =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'720'%20height%3D'300'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'719'%20height%3D'299'%20rx%3D'8'%20fill%3D'rgb(246%2C247%2C249)'%20stroke%3D'rgb(199%2C205%2C214)'%20stroke-dasharray%3D'6%205'%2F%3E%3Ctext%20x%3D'360'%20y%3D'144'%20font-family%3D'sans-serif'%20font-size%3D'13'%20font-weight%3D'700'%20fill%3D'rgb(100%2C108%2C124)'%20text-anchor%3D'middle'%3EPhoto%3C%2Ftext%3E%3Ctext%20x%3D'360'%20y%3D'164'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(150%2C158%2C172)'%20text-anchor%3D'middle'%3ETap%20to%20add%20photo%3C%2Ftext%3E%3C%2Fsvg%3E";

/**
 * The layouts behind "New template".
 *
 * These are held to the same standard as the seeded library, and the reason is
 * a client's words about this exact screen: the built-ins "look nice and
 * editable" while the templates a team owns "are terrible". Both sets sit in
 * one grid, so the difference was the whole impression of the page.
 *
 * The old bodies were a run of bare headings over `<ul>` bullets. The library
 * next to them opens with a titled cover line, states the job in a key/value
 * table, and lays out grids to fill and photo slots to tap. What follows is
 * that same shape, so a team's own first template arrives looking like the
 * library it sits beside rather than like a draft of it.
 *
 * The house style, matched deliberately:
 *   - `<h1>` naming the document, then the project line, then a grey meta line;
 *   - `<hr>`, then a key/value table for the facts about the visit;
 *   - grey italic guidance above a section, never filler prose inside it;
 *   - `[Bracketed prompts]` in cells, which `bracketsToFillFields` turns into
 *     click-to-type blanks when the document is created;
 *   - photo slots and a sign-off table where the document is one someone hands
 *     over.
 *
 * No newlines inside a `<table>`: the HTML parser foster-parents stray text out
 * of table markup, which quietly relocates it above the table.
 */
const STYLE_PRESETS: {
  key: DocStyle;
  label: string;
  icon: typeof FileText;
  description: string;
  html: string;
}[] = [
  {
    key: "report",
    label: "Report",
    icon: Newspaper,
    description: "Findings and recommendations, with photos and a sign-off.",
    html: `<h1>Field Report</h1>
<p><strong>{{project_name}}</strong> &nbsp;·&nbsp; {{project_address}}</p>
<p><span style="color: rgb(120,128,142)">{{date}} &nbsp;·&nbsp; Prepared by {{prepared_by}} &nbsp;·&nbsp; {{company_name}}</span></p>
<hr>
<table><tbody><tr><th><p>Report #</p></th><td><p>[Report #]</p></td></tr><tr><th><p>Visit type</p></th><td><p>[Routine / callout / follow-up]</p></td></tr><tr><th><p>Site contact</p></th><td><p>[Name and number]</p></td></tr><tr><th><p>Weather</p></th><td><p>{{weather}}</p></td></tr></tbody></table>
<h2>Overview</h2>
<p><em><span style="color: rgb(140,148,162)">Why you were on site, who you met, and the overall condition.</span></em></p>
<p></p>
<h2>What we found</h2>
<table><tbody><tr><th><p>Location</p></th><th><p>What we found</p></th><th><p>Priority</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<p><img src="${PHOTO_SLOT}" width="32%" height="260" alt="Finding 1"><img src="${PHOTO_SLOT}" width="32%" height="260" alt="Finding 2"><img src="${PHOTO_SLOT}" width="32%" height="260" alt="Finding 3"></p>
<h2>Recommendations</h2>
<table><tbody><tr><th><p>#</p></th><th><p>What should happen</p></th><th><p>Owner</p></th><th><p>By when</p></th></tr><tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>3</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<hr>
<h2>Sign-off</h2>
<table><tbody><tr><th><p></p></th><th><p>Name</p></th><th><p>Date</p></th><th><p>Signature</p></th></tr><tr><td><p><strong>Prepared by</strong></p></td><td><p>{{prepared_by}}</p></td><td><p>{{date}}</p></td><td><p></p></td></tr><tr><td><p><strong>Client</strong></p></td><td><p>{{client_name}}</p></td><td><p></p></td><td><p></p></td></tr></tbody></table>`,
  },
  {
    key: "letter",
    label: "Letter",
    icon: FileSignature,
    description: "Letterhead, the ask set out in a table, and a signature block.",
    html: `<p><span style="color: rgb(120,128,142)">{{company_name}} &nbsp;·&nbsp; {{company_address}} &nbsp;·&nbsp; {{company_phone}}</span></p>
<hr>
<p>{{date}}</p>
<p><strong>{{client_name}}</strong><br>{{client_contact}}<br>{{project_address}}</p>
<p><strong>Re: {{project_name}}</strong></p>
<p>Dear {{client_name}},</p>
<p><em><span style="color: rgb(140,148,162)">One line on why you are writing, then the detail below.</span></em></p>
<p>[Why you are writing]</p>
<p></p>
<h2>What we are asking for</h2>
<table><tbody><tr><th><p>Item</p></th><th><p>Detail</p></th><th><p>By when</p></th></tr><tr><td><p>[Item]</p></td><td><p>[Detail]</p></td><td><p>[Date]</p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<p>Please come back to us with anything you need from our side.</p>
<p>Sincerely,</p>
<p>{{prepared_by}}<br>{{prepared_by_title}}<br>{{company_name}}</p>`,
  },
  {
    key: "checklist",
    label: "Checklist summary",
    icon: FileCheck2,
    description: "Tick boxes for what was done, a table for what is still open.",
    html: `<h1>Checklist Summary</h1>
<p><strong>{{project_name}}</strong> &nbsp;·&nbsp; {{project_address}}</p>
<p><span style="color: rgb(120,128,142)">{{date}} &nbsp;·&nbsp; Completed by {{prepared_by}} &nbsp;·&nbsp; {{company_name}}</span></p>
<hr>
<h2>Completed</h2>
<p><em><span style="color: rgb(140,148,162)">Tick what was done. Add a line for anything the list did not cover.</span></em></p>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>[First item]</p></li><li data-type="taskItem" data-checked="false"><p>[Second item]</p></li><li data-type="taskItem" data-checked="false"><p>[Third item]</p></li><li data-type="taskItem" data-checked="false"><p>[Fourth item]</p></li></ul>
<p><img src="${PHOTO_SLOT}" width="48%" height="260" alt="Work completed"><img src="${PHOTO_SLOT}" width="48%" height="260" alt="Work completed"></p>
<h2>Still open</h2>
<table><tbody><tr><th><p>Item</p></th><th><p>Why it is open</p></th><th><p>Owner</p></th><th><p>By when</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<hr>
<p><span style="color: rgb(120,128,142)">Signed {{prepared_by}}, {{prepared_by_title}} &nbsp;·&nbsp; {{date}}</span></p>`,
  },
  {
    key: "memo",
    label: "Memo",
    icon: FileText,
    description: "Short internal note with a header block and an action list.",
    html: `<h1>Memorandum</h1>
<table><tbody><tr><th><p>To</p></th><td><p>{{client_name}}</p></td></tr><tr><th><p>From</p></th><td><p>{{prepared_by}}, {{prepared_by_title}}</p></td></tr><tr><th><p>Date</p></th><td><p>{{date}}</p></td></tr><tr><th><p>Re</p></th><td><p>{{project_name}}</p></td></tr></tbody></table>
<hr>
<p><em><span style="color: rgb(140,148,162)">Lead with the decision or the ask. Detail underneath it.</span></em></p>
<p>[The point of this memo]</p>
<p></p>
<h2>Actions</h2>
<table><tbody><tr><th><p>Action</p></th><th><p>Owner</p></th><th><p>By when</p></th></tr><tr><td><p>[Action]</p></td><td><p>[Owner]</p></td><td><p>[Date]</p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>`,
  },
  {
    key: "walkthrough",
    label: "Walkthrough report",
    icon: Footprints,
    description: "Area-by-area observations with before and after photos.",
    html: `<h1>Walkthrough Report</h1>
<p><strong>{{project_name}}</strong> &nbsp;·&nbsp; {{project_address}}</p>
<p><span style="color: rgb(120,128,142)">{{date}} &nbsp;·&nbsp; Led by {{prepared_by}} &nbsp;·&nbsp; {{company_name}}</span></p>
<hr>
<table><tbody><tr><th><p>Project #</p></th><td><p>{{project_number}}</p></td></tr><tr><th><p>Weather</p></th><td><p>{{weather}}</p></td></tr><tr><th><p>Purpose</p></th><td><p>[Progress / handover / snag review]</p></td></tr></tbody></table>
<h2>Attendees</h2>
<table><tbody><tr><th><p>Name</p></th><th><p>Role</p></th><th><p>Company</p></th></tr><tr><td><p>{{prepared_by}}</p></td><td><p>{{prepared_by_title}}</p></td><td><p>{{company_name}}</p></td></tr><tr><td><p>{{client_name}}</p></td><td><p>[Role]</p></td><td><p>[Company]</p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Area 1</h2>
<p><em><span style="color: rgb(140,148,162)">Name the area, then what you saw and whether it is on track.</span></em></p>
<table><tbody><tr><th><p>Area</p></th><td><p>[Area]</p></td></tr><tr><th><p>Observation</p></th><td><p>[What was seen]</p></td></tr><tr><th><p>Status</p></th><td><p>[On track / delayed / needs attention]</p></td></tr></tbody></table>
<p><img src="${PHOTO_SLOT_BEFORE}" width="48%" height="260" alt="Area 1 before"><img src="${PHOTO_SLOT_AFTER}" width="48%" height="260" alt="Area 1 after"></p>
<h2>Area 2</h2>
<table><tbody><tr><th><p>Area</p></th><td><p>[Area]</p></td></tr><tr><th><p>Observation</p></th><td><p>[What was seen]</p></td></tr><tr><th><p>Status</p></th><td><p>[On track / delayed / needs attention]</p></td></tr></tbody></table>
<p><img src="${PHOTO_SLOT_BEFORE}" width="48%" height="260" alt="Area 2 before"><img src="${PHOTO_SLOT_AFTER}" width="48%" height="260" alt="Area 2 after"></p>
<h2>Action items</h2>
<table><tbody><tr><th><p>#</p></th><th><p>Action</p></th><th><p>Owner</p></th><th><p>By when</p></th></tr><tr><td><p>1</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>2</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p>3</p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Next walkthrough</h2>
<table><tbody><tr><th><p>Date</p></th><td><p>[Date]</p></td></tr><tr><th><p>Focus</p></th><td><p>[Areas to cover next]</p></td></tr></tbody></table>
<hr>
<p><span style="color: rgb(120,128,142)">Signed {{prepared_by}} &nbsp;·&nbsp; {{date}}</span></p>`,
  },
  {
    key: "sitelog",
    label: "Site log",
    icon: ClipboardList,
    description: "Daily record of crew, deliveries, progress, delays and photos.",
    html: `<h1>Daily Site Log</h1>
<p><strong>{{project_name}}</strong> &nbsp;·&nbsp; {{project_address}}</p>
<p><span style="color: rgb(120,128,142)">{{date}} &nbsp;·&nbsp; Prepared by {{prepared_by}} &nbsp;·&nbsp; {{company_name}}</span></p>
<hr>
<table><tbody><tr><th><p>Project #</p></th><td><p>{{project_number}}</p></td></tr><tr><th><p>Weather</p></th><td><p>{{weather}}</p></td></tr><tr><th><p>Hours on site</p></th><td><p>[Start and finish]</p></td></tr><tr><th><p>Supervisor</p></th><td><p>[Name]</p></td></tr></tbody></table>
<h2>Crew on site</h2>
<table><tbody><tr><th><p>Trade</p></th><th><p>Company</p></th><th><p>Headcount</p></th><th><p>Hours</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Work performed</h2>
<table><tbody><tr><th><p>Area</p></th><th><p>What was done</p></th><th><p>% done</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<p><img src="${PHOTO_SLOT}" width="32%" height="260" alt="Progress 1"><img src="${PHOTO_SLOT}" width="32%" height="260" alt="Progress 2"><img src="${PHOTO_SLOT}" width="32%" height="260" alt="Progress 3"></p>
<h2>Deliveries and equipment</h2>
<table><tbody><tr><th><p>Time</p></th><th><p>Item</p></th><th><p>Qty</p></th><th><p>Received by</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<h2>Delays, issues and safety</h2>
<p><em><span style="color: rgb(140,148,162)">Anything that cost time, and who was told about it.</span></em></p>
<table><tbody><tr><th><p>Issue</p></th><th><p>Raised with</p></th><th><p>Time lost</p></th></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></tbody></table>
<p><img src="${PHOTO_SLOT_WIDE}" width="100%" height="300" alt="Site conditions"></p>
<h2>Plan for tomorrow</h2>
<table><tbody><tr><th><p>Priority</p></th><th><p>Trade responsible</p></th></tr><tr><td><p>[Task]</p></td><td><p>[Trade]</p></td></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>
<hr>
<p><span style="color: rgb(120,128,142)">Signed {{prepared_by}}, {{prepared_by_title}} &nbsp;·&nbsp; {{date}}</span></p>`,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseBody(raw: any): DocBody {
  if (raw && typeof raw === "object" && typeof raw.html === "string") {
    return {
      style: (raw.style as DocStyle) ?? "report",
      html: raw.html,
      description: raw.description ?? "",
      category: typeof raw.category === "string" && raw.category ? raw.category : undefined,
      copiedFrom: typeof raw.copiedFrom === "string" && raw.copiedFrom ? raw.copiedFrom : undefined,
    };
  }
  return { style: "report", html: "", description: "" };
}

/** The section heading a template files under. Same key the picker groups by. */
function templateCategory(t: DocumentTemplate): string {
  return parseBody(t.body).category ?? GENERAL_CATEGORY;
}

function extractFields(html: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) set.add(m[1].toLowerCase());
  return Array.from(set).sort();
}

const SAMPLE: Record<string, string> = {
  project_name: "Maple Ridge Renovation",
  project_address: "1234 Elm Street, Springfield",
  project_number: "PRJ-00421",
  client_name: "Sarah Whitfield",
  client_contact: "sarah@example.com",
  date: new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }),
  prepared_by: "Alex Morgan",
  prepared_by_title: "Project Manager",
  weather: "Sunny, 72°F",
  company_name: "Everbreeze Construction",
  company_address: "800 Harbor Blvd, Suite 210",
  company_phone: "(555) 123-4567",
};

function fillPreview(
  html: string,
  mode: "sample" | "token" = "sample",
  overrides: Record<string, string> = {},
): string {
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, k) => {
    const token = k.toLowerCase();
    const label = LABEL_BY_TOKEN[token] ?? token.replace(/_/g, " ");
    if (mode === "token") {
      return `<span class="doc-chip doc-chip-token" title="${escapeAttr(token)}">${escapeAttr(label)}</span>`;
    }
    const v = overrides[token] ?? SAMPLE[token];
    return v
      ? `<span class="doc-chip doc-chip-filled">${escapeAttr(v)}</span>`
      : `<span class="doc-chip doc-chip-missing">${escapeAttr(label)}</span>`;
  });
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/**
 * Fields the seeded SQL library merges that the authoring list above has no
 * entry for. `{{company}}` is the big one - 30 uses across the built-ins - and
 * it is deliberately not in PLACEHOLDERS, which would offer the author two
 * identical "Company name" chips inserting different tokens.
 */
const SNIPPET_ALIASES: Record<string, string> = { company: "Company name" };

/** Mirrors `fieldLabel` in apps/api/.../pages.ts, for text the server never sees. */
function snippetLabel(token: string): string {
  const known = LABEL_BY_TOKEN[token] ?? SNIPPET_ALIASES[token];
  if (known) return known;
  const words = token.replace(/_+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : token;
}

/**
 * The grey summary line on a template card.
 *
 * Reads as prose rather than as source. Stripping tags alone left the card
 * previewing `{{project_name}} &nbsp;-&nbsp; Walkthrough Log`, which is both
 * the merge syntax and a raw entity, on the one screen whose whole job is
 * helping someone recognise a document by sight.
 */
function templateSnippet(html: string): string {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, raw: string) => snippetLabel(raw.toLowerCase()))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    // Last, so an escaped entity like `&amp;nbsp;` is not decoded twice.
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 180) || "Empty document";
}

// ---------------------------------------------------------------------------
// Placeholder decoration - styles {{token}} as an editable pill in the editor.
// The raw text stays fully selectable/deletable; we only add a class so it
// visually reads as a chip. Placeholders remain 100% editable.
// ---------------------------------------------------------------------------
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

const LABEL_BY_TOKEN: Record<string, string> = PLACEHOLDERS.reduce(
  (acc, p) => {
    acc[p.token] = p.label;
    return acc;
  },
  {} as Record<string, string>,
);

export const placeholderChipsKey = new PluginKey("placeholder-chips");

const PlaceholderChips = Extension.create<{ getValue: (token: string) => string | undefined }>({
  name: "placeholderChips",
  addOptions() {
    return { getValue: () => undefined };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key: placeholderChipsKey,
        state: {
          init: () => ({ tick: 0 }),
          apply(tr, value) {
            const meta = tr.getMeta(placeholderChipsKey);
            if (meta !== undefined) return { tick: (value.tick ?? 0) + 1 };
            return value;
          },
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              const text = node.text;
              const re = new RegExp(PLACEHOLDER_RE.source, "gi");
              let match: RegExpExecArray | null;
              while ((match = re.exec(text)) !== null) {
                const from = pos + match.index;
                const to = from + match[0].length;
                const token = match[1].toLowerCase();
                const label = LABEL_BY_TOKEN[token] ?? token.replace(/_/g, " ");
                const filled = opts.getValue(token);
                if (filled && filled.trim()) {
                  // Hide the raw {{token}} text and render a filled pill widget in its place.
                  decos.push(
                    Decoration.inline(from, to, {
                      class: "doc-chip-hidden",
                    }),
                  );
                  decos.push(
                    Decoration.widget(
                      from,
                      () => {
                        const span = document.createElement("span");
                        span.className = "doc-chip-inline doc-chip-filled-inline";
                        span.textContent = filled;
                        span.setAttribute("title", `${label} - live value from Fields panel`);
                        span.setAttribute("data-token", token);
                        return span;
                      },
                      { side: -1, ignoreSelection: true },
                    ),
                  );
                } else {
                  decos.push(
                    Decoration.inline(from, to, {
                      class: "doc-chip-inline",
                      title: `${label} - editable placeholder`,
                    }),
                  );
                }
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function DocumentTemplatesManager({ teamId, canManage }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [items, setItems] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  /** Which trade section is on screen. `null` = every one of them. */
  const [trade, setTrade] = useState<string | null>(null);
  /*
   * The company's own trades, from the account setup wizard. They reorder the
   * sections below and decide which chip the trade filter opens on, so a
   * cleaning contractor stops finding their templates seventh.
   */
  const { profile: company } = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.industry, company.trades),
    [company.industry, company.trades],
  );
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStyle, setNewStyle] = useState<DocStyle>("report");
  const [newCategory, setNewCategory] = useState<string>(GENERAL_CATEGORY);
  /** Template awaiting a project to be applied to. */
  const [useFor, setUseFor] = useState<DocumentTemplate | null>(null);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; location: string | null }>
  >([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  /*
   * Step two: the project is chosen, and now the fields nothing can auto-fill
   * get asked for against a preview of the finished document. Picking a project
   * used to create the page immediately and drop the author into the editor to
   * repair whatever came out of it.
   */
  const [useIn, setUseIn] = useState<{
    template: DocumentTemplate;
    project: { id: string; name: string };
  } | null>(null);

  const openUse = (t: DocumentTemplate) => {
    setUseFor(t);
    setProjectsLoading(true);
    void (async () => {
      try {
        const { data } = await supabase
          .from("projects")
          .select("id, name, location, street, city, state")
          .order("updated_at", { ascending: false })
          .limit(50);
        setProjects(
          ((data as any[]) ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            location: p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ") ?? null,
          })),
        );
      } catch {
        setProjects([]);
      } finally {
        setProjectsLoading(false);
      }
    })();
  };

  const chooseProject = (project: { id: string; name: string }) => {
    if (!useFor) return;
    setUseIn({ template: useFor, project });
    setUseFor(null);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("document_templates" as any)
      .select("*")
      .order("updated_at", { ascending: false });
    if (teamId) q = q.or(`team_id.eq.${teamId},team_id.is.null`);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    else setItems((data ?? []) as unknown as DocumentTemplate[]);
    setLoading(false);
  }

  /**
   * Built-ins the team has made their own version of, by id.
   *
   * The company's row stands in for the example rather than sitting next to it,
   * which is what stops "I edited an example" from reading as "the library grew
   * a card". One document, one card, whoever owns it.
   *
   * Only a live row shadows: archive or delete the company's version and the
   * example is back on the page, which is also the undo for having made one.
   * Reading `items` rather than `visible` keeps that true under "Show archived",
   * where an archived copy is on screen and must not hide anything.
   */
  const shadowedExamples = useMemo(() => {
    const out = new Set<string>();
    for (const t of items) {
      if (t.team_id === null || t.archived) continue;
      const from = parseBody(t.body).copiedFrom;
      if (from) out.add(from);
    }
    return out;
  }, [items]);

  const visible = useMemo(
    () =>
      items.filter(
        (i) =>
          (showArchived ? true : !i.archived) &&
          !(i.team_id === null && shadowedExamples.has(i.id)),
      ),
    [items, showArchived, shadowedExamples],
  );

  /**
   * Template id -> the name of the older card holding the exact same document.
   *
   * The client's report was "massive duplication", and the part of it that
   * survived the cleanup migrations is the part nothing on screen admitted to:
   * "HVAC Service Call Report (copy)" and "... (copy) (copy)" are one document
   * on two cards, and the only clue was counting the word "copy". Names are a
   * bad test anyway - the pair created 24 seconds apart is a Duplicate click,
   * while "CLEANING SERVICES - Invoice With Photos (copy)" says copy in its name
   * and is a document of its own.
   *
   * So the body is the test, compared whole rather than hashed: exact string
   * equality is what "the same document" means here, and it is what the
   * companion migration (20260904000000) partitions on, so the badge and the
   * sweep can never disagree about what counts as a duplicate.
   *
   * Only the newer rows are listed. The oldest is what the copies were made
   * from, so it stays unmarked and the badge points at the cards that can go -
   * a card that says "delete me" beats N cards that each say "one of us is
   * redundant".
   */
  const duplicateOf = useMemo(() => {
    const byBody = new Map<string, DocumentTemplate[]>();
    for (const t of visible) {
      // Built-ins are shared by every team and identical for everyone, so they
      // are not duplicates of each other and not anyone's to tidy.
      if (t.team_id === null) continue;
      const html = parseBody(t.body).html;
      if (!html) continue;
      const list = byBody.get(html);
      if (list) list.push(t);
      else byBody.set(html, [t]);
    }
    const out = new Map<string, string>();
    for (const list of byBody.values()) {
      if (list.length < 2) continue;
      const [keeper, ...rest] = [...list].sort(
        (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
      for (const dupe of rest) out.set(dupe.id, keeper.name);
    }
    return out;
  }, [visible]);

  /**
   * The library split by trade, which is how a crew actually looks for a
   * document: this page used to be one flat grid of thirty cards where an
   * electrician's panel inspection sat between a water heater install and a
   * cleaning invoice.
   *
   * Sections follow the picker's trade order, so the sheet a tech finds under
   * HVAC in a project is under HVAC here too. Within a section the team's own
   * templates come first - those are the editable ones - then the read-only
   * built-ins, each alphabetically.
   */
  const sections = useMemo<Array<[string, DocumentTemplate[]]>>(() => {
    const byCategory = new Map<string, DocumentTemplate[]>();
    for (const t of visible) {
      const key = templateCategory(t);
      const list = byCategory.get(key);
      if (list) list.push(t);
      else byCategory.set(key, [t]);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => {
        const aExample = a.team_id === null;
        const bExample = b.team_id === null;
        if (aExample !== bExample) return aExample ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    }
    return Array.from(byCategory.entries()).sort(
      (a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]),
    );
  }, [visible, rank]);

  /**
   * The company's own trade, when the library has anything filed under it.
   *
   * Same source as the in-project picker, so the heading badged "Your trade"
   * here is the one that opens itself there. Null for a company that has not
   * answered, and for the two industries with no trade section of their own.
   */
  const ownTrade = useMemo(() => {
    const trade = tradeCategoryFor(company.industry);
    return trade && sections.some(([heading]) => heading === trade) ? trade : null;
  }, [sections, company.industry]);

  /*
   * A filter that outlives its section is a page that looks empty: archive the
   * last plumbing template while Plumbing is selected and every card
   * disappears with no way back except a reload.
   */
  useEffect(() => {
    if (trade && !sections.some(([heading]) => heading === trade)) setTrade(null);
  }, [sections, trade]);

  const shownSections = trade ? sections.filter(([heading]) => heading === trade) : sections;

  async function createTemplate() {
    if (!newName.trim()) {
      toast.error("Give your template a name");
      return;
    }
    const preset = STYLE_PRESETS.find((p) => p.key === newStyle)!;
    const body: DocBody = {
      style: preset.key,
      html: preset.html,
      description: "",
      // General is the absence of a trade, not a trade of its own - storing it
      // would file the template under a category the picker does not rank.
      category: newCategory === GENERAL_CATEGORY ? undefined : newCategory,
    };
    const { data, error } = await supabase
      .from("document_templates" as any)
      .insert({
        name: newName.trim(),
        team_id: teamId,
        created_by: user?.id,
        body: body as any,
        fields: extractFields(preset.html),
      })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Template created");
    setCreateOpen(false);
    setNewName("");
    setNewStyle("report");
    setNewCategory(GENERAL_CATEGORY);
    setItems((prev) => [data as unknown as DocumentTemplate, ...prev]);
    setEditor({
      template: data as unknown as DocumentTemplate,
      name: (data as unknown as DocumentTemplate).name,
      body: parseBody((data as unknown as DocumentTemplate).body),
    });
  }

  /*
   * Open an EXISTING template through the API rather than from the row we
   * already hold.
   *
   * `load()` reads `document_templates` straight from the browser with
   * `select("*")`, and the editor renders `editor.body.html` through
   * `dangerouslySetInnerHTML`. Template bodies are authored HTML that came from
   * a project page, they are shared across the whole team, and a teammate can
   * write one directly via PostgREST - so rendering the raw column is stored
   * XSS against every other member of the team.
   *
   * `getDocumentTemplate` runs the same sanitiser the public page share uses
   * (apps/api sanitize-page-html.ts, covered by tests/sanitize-page-html.test.ts)
   * and returns cleaned HTML. Reusing it beats adding a second, unproven
   * sanitiser to the client - and it disarms rows that are already poisoned,
   * which a write-side fix alone would not.
   *
   * `style` and `description` still come from the local row: they are plain
   * strings the API does not return, and neither is ever rendered as HTML.
   */
  async function openForEdit(t: DocumentTemplate) {
    const local = parseBody(t.body);
    try {
      const fresh = await getDocumentTemplate({ data: { templateId: t.id } });
      setEditor({
        template: t,
        name: t.name,
        body: { ...local, html: (fresh as { html?: string })?.html ?? "" },
      });
    } catch (e: any) {
      // Never fall back to the unsanitised local copy - that is the bug.
      toast.error(e?.message ?? "Could not open this template");
    }
  }

  /*
   * The sample-site-logs button used to sit here. It wrote three team-owned
   * copies of the preset bodies - a basic log, a walkthrough log and an HVAC
   * log - and it is where the templates the client called terrible came from.
   *
   * Every one of the three is covered better by a built-in the library already
   * ships: Daily Site Report and Site Visit Report under Field Reports, and the
   * HVAC service and maintenance sheets under HVAC. So the button's only real
   * effect was to drop worse duplicates of existing cards into General, owned
   * by the team and therefore the only ones on the page carrying an Edit and a
   * delete. Two tiers of quality in one grid, with the worse tier the one that
   * looked editable.
   *
   * Anyone wanting an editable copy of a sample now takes "Make an editable
   * copy" on the built-in itself, which starts them from the good body.
   */

  async function persist() {
    if (!editor?.template) return;
    setSaving(true);
    const fields = extractFields(editor.body.html);
    const { error } = await supabase
      .from("document_templates" as any)
      .update({
        name: editor.name.trim() || "Untitled document",
        body: editor.body as any,
        fields,
      })
      .eq("id", editor.template.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Template saved");
    await load();
    setEditor(null);
  }

  /**
   * Edit a template, whoever owns it.
   *
   * On the team's own row this is a plain edit. On a built-in it cannot be:
   * those belong to no team, every company sees the same row, and RLS rejects
   * the write. The page used to answer that with a second button reading
   * "Duplicate to edit" - a database constraint written out as a chore for
   * whoever is holding the phone, and following it left a second card in the
   * grid. The client, pointing at that button: "I am not sure what the point of
   * duplicating is ... creating duplicates is a big mess."
   *
   * So the copy happens here instead, and `shadowedExamples` hides the built-in
   * behind the row it produced. Press Edit, get the editor, and the number of
   * cards on the page does not move.
   */
  async function edit(t: DocumentTemplate) {
    if (t.team_id !== null) return openForEdit(t);
    await copyForEditing(t);
    toast.success("Editing your company's version", {
      description: `The example "${t.name}" is shared with every company, so this is yours to change. Delete it and the example comes back.`,
    });
  }

  /**
   * Make a copy of a template and open it for editing, as one action.
   *
   * Copying used to end at the insert: it wrote a row byte-identical to the one
   * it came from, toasted "Duplicated", and left a second card in the section -
   * so the grid grew a twin every time someone pressed it to find out what it
   * did, and the twin was indistinguishable from its original.
   *
   * A copy is only worth having once it differs from the original, so the copy
   * and the edit are one gesture: this opens the editor on the new row
   * immediately, and `closeEditor` deletes it again if it is closed unchanged.
   * The library can no longer accumulate a card nobody meant to create.
   */
  async function copyForEditing(t: DocumentTemplate) {
    const isExample = t.team_id === null;
    const body = t.body && typeof t.body === "object" ? { ...(t.body as object) } : t.body;
    /*
     * A copy of an example replaces it on the page, so it takes the original's
     * name rather than "... (copy)": there is nothing left beside it for the
     * suffix to distinguish it from. `nextCopyName` still runs when that name is
     * somehow taken - by a copy made before this existed, say - because two
     * cards reading exactly the same thing is worse than a suffix.
     *
     * `items` and not `visible`, so an archived row still reserves its name: a
     * collision the user cannot see is still a collision.
     */
    const taken = items.map((i) => i.name);
    const free = !taken.some((n) => n.trim().toLowerCase() === t.name.trim().toLowerCase());
    const { data, error } = await supabase
      .from("document_templates" as any)
      .insert({
        name: isExample && free ? t.name : nextCopyName(t.name, taken),
        // Never inherit a null team_id from an example - the copy must belong
        // to the caller's team so it is editable.
        team_id: teamId ?? null,
        created_by: user?.id,
        // Provenance, so the example this stands in for can step aside. Only
        // for an example: a copy of the team's own template is a second
        // template, and both belong on the page.
        body: isExample ? { ...(body as object), copiedFrom: t.id } : body,
        fields: t.fields,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    const copy = data as unknown as DocumentTemplate;
    /*
     * Deliberately not added to `items` here. Until the editor is saved this
     * row is provisional, and listing it would put the identical twin back on
     * the page - which is the thing being fixed. `persist` reloads the library,
     * and `closeEditor` deletes the row if nothing came of the edit.
     */
    setEditor({ template: copy, name: copy.name, body: parseBody(copy.body), fresh: true });
  }

  /**
   * Leave the editor, throwing away a copy that never became its own document.
   *
   * Only ever deletes a row this session created (`fresh`) and has not saved,
   * so an existing template is never at risk. An edited-but-unsaved copy asks
   * first: those edits are lost either way, but losing them silently AND losing
   * the row is not something to do on a stray Escape.
   */
  async function closeEditor() {
    const open = editor;
    if (!open?.fresh || !open.template) {
      setEditor(null);
      return;
    }
    const stored = parseBody(open.template.body);
    const untouched = open.body.html === stored.html && open.name === open.template.name;
    if (
      !untouched &&
      !(await confirm({
        title: "Discard this copy?",
        description: `"${open.template.name}" hasn't been saved, so nothing is added to your templates.`,
        confirmText: "Discard copy",
        cancelText: "Keep editing",
        variant: "destructive",
      }))
    )
      return;
    setEditor(null);
    const { error } = await supabase
      .from("document_templates" as any)
      .delete()
      .eq("id", open.template.id);
    // The row survived the delete, so it is on the page whether we say so or
    // not. Reload rather than leave the grid disagreeing with the database.
    if (error) await load();
  }

  /**
   * Refile a template under another trade, from the card.
   *
   * The editor has the same control, but reaching it means opening a
   * full-screen document editor and saving it to move one card - which is a
   * lot of ceremony for the templates that predate trades and sit in General.
   *
   * The stored body is spread rather than rebuilt from `parseBody`, which only
   * knows four keys: anything else a template carries has to survive being
   * refiled.
   */
  async function assignTrade(t: DocumentTemplate, category: string | null) {
    const raw =
      t.body && typeof t.body === "object" ? { ...(t.body as Record<string, unknown>) } : {};
    if (category) raw.category = category;
    else delete raw.category;
    const { error } = await supabase
      .from("document_templates" as any)
      .update({ body: raw as any })
      .eq("id", t.id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.map((i) => (i.id === t.id ? { ...i, body: raw } : i)));
    toast.success(`Filed under ${category ?? GENERAL_CATEGORY}`);
  }

  async function toggleArchive(t: DocumentTemplate) {
    const { error } = await supabase
      .from("document_templates" as any)
      .update({ archived: !t.archived })
      .eq("id", t.id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.map((i) => (i.id === t.id ? { ...i, archived: !t.archived } : i)));
  }

  async function remove(t: DocumentTemplate) {
    if (
      !(await confirm({
        description: `Delete "${t.name}"? This can't be undone.`,
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from("document_templates" as any)
      .delete()
      .eq("id", t.id);
    if (error) return toast.error(error.message);
    setItems((prev) => prev.filter((i) => i.id !== t.id));
    toast.success("Deleted");
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ChipStyles />
      <SectionHeading
        eyebrow="Reusable documents"
        title="Document templates"
        description="Word-style templates with dynamic placeholders that auto-fill from project data."
        actions={
          <>
            <Button
              variant="outline"
              className={SURFACE_BUTTON}
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            {canManage && (
              <Button className={SURFACE_BUTTON} onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> New template
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
        {/*
          States the model outright, because the page previously implied a
          different one. "Duplicate to edit" sat next to "Use in a project" at
          the same weight, so the obvious reading was that a template has to be
          copied before it can be changed - and following that reading leaves a
          new template behind on every job. The client's words: "Clean templates
          should be allowed to be applied to projects ... creating duplicates is
          a big mess."
        */}
        <div>
          <p className="font-semibold">Templates stay clean. Your edits live on the job.</p>
          <p className="mt-0.5 text-blue-900/80 dark:text-blue-200/80">
            Hit <strong>Use in a project</strong> on any template below and pick the job. You get a
            preview with that project&rsquo;s details already merged in, plus a box for each thing
            it can&rsquo;t know, so the document arrives finished. It&rsquo;s filed under that
            project&rsquo;s <strong>Documents</strong>, where you can rewrite as much of it as the
            job needs: the template itself never changes, and no copy of it is created. The same
            templates are in a project under <strong>Documents → Create → More Templates</strong>.
          </p>
          <p className="mt-1.5 text-blue-900/80 dark:text-blue-200/80">
            To change a template for good, hit <strong>Edit</strong>. On an example that gives you
            your company&rsquo;s own version, which takes the example&rsquo;s place here and in the
            project picker, so the list stays the same length. Delete it and the example is back.
          </p>
        </div>
      </div>

      {/* Trade filter. Eleven sections is a long page to scroll, so a sparky can
          cut it to the one that is theirs. Hidden when everything on the page
          is one trade already, where it would only ever be a no-op.

          The chips follow `sections`, which the business profile reorders, so
          the company's own trade is the first one after "All trades" rather
          than wherever the fixed order happens to put it. */}
      {sections.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-extrabold uppercase tracking-[1.4px] text-muted-foreground">
            Trade
          </span>
          <button
            type="button"
            onClick={() => setTrade(null)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-bold transition",
              trade === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent",
            )}
          >
            All trades
            <span className="ml-1.5 opacity-70">{visible.length}</span>
          </button>
          {sections.map(([heading, list]) => {
            const Icon = categoryIcon(heading);
            return (
              <button
                key={heading}
                type="button"
                onClick={() => setTrade(heading === trade ? null : heading)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition",
                  trade === heading
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {heading}
                <span className="opacity-70">{list.length}</span>
                {heading === ownTrade && <span aria-label="Your trade">★</span>}
              </button>
            );
          })}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No document templates yet"
          description="Create reusable Word-style documents with dynamic project placeholders."
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Create template
              </Button>
            ) : null
          }
        />
      ) : (
        shownSections.map(([heading, list]) => {
          const TradeIcon = categoryIcon(heading);
          return (
            <section key={heading} className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <TradeIcon className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-bold tracking-tight text-foreground">{heading}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                  {list.length}
                </span>
                {heading === ownTrade && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.6px] text-primary">
                    Your trade
                  </span>
                )}
                <span className="h-px flex-1 bg-border/60" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.map((t) => {
                  const body = parseBody(t.body);
                  const preset =
                    STYLE_PRESETS.find((p) => p.key === body.style) ?? STYLE_PRESETS[0];
                  const Icon = preset.icon;
                  // Built-in examples (no team, no owner) are read-only for everyone -
                  // RLS rejects writes to them, so only Duplicate is offered.
                  const isExample = t.team_id === null;
                  /** The older card holding this exact document, if there is one. */
                  const twinOf = duplicateOf.get(t.id);
                  return (
                    <Card
                      key={t.id}
                      className={cn(SURFACE_CARD_INTERACTIVE, "flex flex-col gap-3.5 p-5")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                            <Icon className="h-[18px] w-[18px]" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[15px] font-bold tracking-tight text-foreground">
                              {t.name}
                            </div>
                            <div className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                              {preset.label} · {t.fields.length} placeholder
                              {t.fields.length === 1 ? "" : "s"}
                            </div>
                            {/* The trade, changeable in place. Read-only on the
                                built-ins, which RLS will not let anyone
                                rewrite anyway. */}
                            <TradeChip
                              category={body.category ?? GENERAL_CATEGORY}
                              editable={canManage && !isExample}
                              onChange={(next) => void assignTrade(t, next)}
                            />
                          </div>
                        </div>
                        {isExample ? (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Example
                          </Badge>
                        ) : body.copiedFrom ? (
                          /*
                            This row is standing in for a built-in that is no
                            longer on the page. Said on the card, because a
                            template that silently replaced another one is the
                            sort of thing someone should be able to find out
                            about without being told.
                          */
                          <Badge
                            variant="outline"
                            title="Your company's version of an example template. It replaces the example here and in the project picker. Delete it and the example comes back."
                            className="shrink-0 text-[10px]"
                          >
                            Your version
                          </Badge>
                        ) : t.archived ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Archived
                          </Badge>
                        ) : twinOf ? (
                          /*
                            Amber rather than destructive: this card is redundant,
                            not broken, and the copy is a statement of fact with
                            the remedy attached. The full name of the card it
                            duplicates goes in the tooltip because it is often
                            the same string as this one bar a "(copy)", and two
                            near-identical names side by side read as noise.
                          */
                          <Badge
                            variant="outline"
                            title={`Byte-for-byte the same document as "${twinOf}". Deleting this one changes nothing except the length of this page.`}
                            className="shrink-0 gap-1 border-amber-300 bg-amber-50 text-[10px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                          >
                            <Copy className="h-2.5 w-2.5" />
                            Duplicate
                          </Badge>
                        ) : null}
                      </div>
                      {twinOf && !t.archived && (
                        <p className="-mt-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                          Same document as <span className="font-semibold">{twinOf}</span>. Nothing
                          here is lost by deleting it.
                        </p>
                      )}
                      <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground line-clamp-3">
                        {templateSnippet(body.html)}
                      </div>
                      {/*
                        Two verbs on the card, everything else behind the "···".

                        This row used to carry up to five buttons of equal
                        weight, two of which made copies - and on a built-in the
                        copy button read "Duplicate to edit", which states that
                        editing a template requires copying it first. It does
                        not: a document is tailored per job by using the
                        template in that project and editing it there, and a
                        built-in is made yours by pressing Edit like any other
                        card. The client read the row exactly as it was written
                        and answered "creating duplicates is a big mess".

                        Duplicate survives only where it means something a verb
                        above cannot: a SECOND template beside one you already
                        own. On a built-in there is nothing left for it to do,
                        so it is not offered.
                      */}
                      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border/60 pt-3">
                        {/* The primary verb. Without it the Templates page could only
                      author templates, never apply one - which is exactly why
                      "not sure how to use that template again" came back as
                      feedback. Available on examples too: using one doesn't
                      write to it, so the read-only rule doesn't apply. */}
                        <Button size="sm" onClick={() => openUse(t)}>
                          <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Use in a project
                        </Button>
                        {canManage && (
                          <Button size="sm" variant="outline" onClick={() => void edit(t)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                        {canManage && !isExample && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="ml-auto h-8 w-8"
                                aria-label={`More actions for ${t.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-72">
                              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Changes the library, not this job
                              </DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => void copyForEditing(t)}>
                                <Copy className="mr-2 h-4 w-4" />
                                <span>
                                  <span className="block font-bold">Duplicate</span>
                                  <span className="block text-xs text-muted-foreground">
                                    A second template you can change without touching this one.
                                  </span>
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => void toggleArchive(t)}>
                                {t.archived ? (
                                  <>
                                    <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
                                  </>
                                ) : (
                                  <>
                                    <Archive className="mr-2 h-4 w-4" /> Archive
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => void remove(t)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                <span>
                                  <span className="block">Delete</span>
                                  {body.copiedFrom && (
                                    <span className="block text-xs text-muted-foreground">
                                      Brings the example back.
                                    </span>
                                  )}
                                </span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* Use-in-a-project picker */}
      <Dialog open={!!useFor} onOpenChange={(o) => !o && setUseFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate">Use “{useFor?.name}”</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pick a project. The next step fills in everything that project knows and asks you for
            the rest, before the document is created.
          </p>
          {projectsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              You don&rsquo;t have any projects yet.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => chooseProject({ id: p.id, name: p.name })}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{p.name}</p>
                    {p.location && (
                      <p className="truncate text-xs text-muted-foreground">{p.location}</p>
                    )}
                  </div>
                  <FilePlus2 className="h-4 w-4 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Step two: fill the blanks against a preview, then create. */}
      <UseTemplateDialog
        templateId={useIn?.template.id ?? null}
        project={useIn?.project ?? null}
        onOpenChange={(o) => !o && setUseIn(null)}
        onCreated={(projectId, pageId) => {
          setUseIn(null);
          // Straight into the new page: the point of "use" is to end up with the
          // document open, not back on a settings screen wondering if it worked.
          navigate({
            to: "/projects/$projectId/pages/$pageId",
            params: { projectId, pageId },
          });
        }}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New document template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Name
              </label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Site visit summary letter"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Trade
              </label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="mt-1 h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Which section it files under, here and in the project template picker.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Start from a style
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {STYLE_PRESETS.map((p) => {
                  const Icon = p.icon;
                  const active = newStyle === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setNewStyle(p.key)}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <div className="text-sm font-medium">{p.label}</div>
                        <div className="text-xs text-muted-foreground">{p.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createTemplate}>
              <Plus className="mr-1 h-4 w-4" /> Create & open editor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editor - full-screen Word-like surface */}
      <Dialog
        open={!!editor}
        onOpenChange={(v) => {
          // Escape and the overlay close through the same path as the X, so a
          // never-saved copy is cleaned up however the editor is left.
          if (!v) void closeEditor();
        }}
      >
        <DialogContent
          className="max-w-none w-screen h-screen p-0 gap-0 rounded-none border-0 sm:rounded-none [&>button]:hidden"
          style={{ background: "var(--muted)" }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Document template editor</DialogTitle>
          </DialogHeader>
          {editor && (
            <DocumentEditorSurface
              editor={editor}
              setEditor={setEditor}
              saving={saving}
              onSave={persist}
              onClose={() => void closeEditor()}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trade chip - the card's "which section am I in", and how to change it
// ---------------------------------------------------------------------------
function TradeChip({
  category,
  editable,
  onChange,
}: {
  category: string;
  editable: boolean;
  /** `null` files it back under General, which stores no category at all. */
  onChange: (category: string | null) => void;
}) {
  const Icon = categoryIcon(category);
  const face = (
    <>
      <Icon className="h-3 w-3" />
      {category}
    </>
  );
  if (!editable) {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
        {face}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Change which trade this files under"
          className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          {face}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          File under
        </DropdownMenuLabel>
        {[GENERAL_CATEGORY, ...CATEGORY_ORDER].map((c) => {
          const RowIcon = categoryIcon(c);
          return (
            <DropdownMenuItem
              key={c}
              onSelect={() => onChange(c === GENERAL_CATEGORY ? null : c)}
              className="flex items-center gap-2"
            >
              <RowIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{c}</span>
              {c === category && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Chip styling (shared by editor + preview + print)
// ---------------------------------------------------------------------------
function ChipStyles() {
  return (
    <style>{`
      .doc-chip {
        display: inline-block;
        padding: 1px 8px;
        margin: 0 1px;
        border-radius: 9999px;
        font-size: 0.85em;
        font-weight: 500;
        line-height: 1.4;
        white-space: nowrap;
      }
      .doc-chip-token {
        background: #dbeafe;
        color: #1e3a8a;
        border: 1px solid #93c5fd;
        cursor: default;
        vertical-align: baseline;
      }
      /* Editor: style the raw {{token}} text as a pill - still fully editable */
      .doc-chip-inline {
        background: #dbeafe;
        color: #1e3a8a;
        border: 1px solid #93c5fd;
        border-radius: 9999px;
        padding: 0 6px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 0.85em;
        font-weight: 500;
        white-space: nowrap;
      }
      .doc-chip-filled-inline {
        background: #dcfce7 !important;
        color: #14532d !important;
        border-color: #86efac !important;
      }
      .doc-chip-hidden {
        display: none;
      }
      .doc-chip-filled {
        background: #dcfce7;
        color: #14532d;
        border: 1px solid #86efac;
      }
      .doc-chip-missing {
        background: #fef3c7;
        color: #78350f;
        border: 1px solid #fcd34d;
      }
      .doc-page {
        background: white;
        color: #111827;
        border-radius: 8px;
        box-shadow: 0 10px 30px -12px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.06);
      }
      .doc-page .ProseMirror {
        outline: none;
        min-height: 60vh;
        font-family: ui-serif, Georgia, "Times New Roman", serif;
        font-size: 15px;
        line-height: 1.7;
      }
      /* The preview pane is the same document, so it gets the same face and
         measure - otherwise "preview" means "the same words in a different
         typeface". */
      .doc-page .doc-preview {
        font-family: ui-serif, Georgia, "Times New Roman", serif;
        font-size: 15px;
        line-height: 1.7;
        color: #111827;
      }
      /* Every rule below is shared with .doc-preview, the read-only pane the
         Preview toggle shows. That pane's className leans on the prose
         utilities, which are a no-op in this app - @tailwindcss/typography is
         not installed, and the codebase declares typography per surface
         instead (see the .tiptap and .wt-markdown blocks in styles.css).
         Nobody ever declared it for this one, so Tailwind's preflight was left
         in charge: headings rendered at body size, lists lost their markers and
         every block lost its margins. An author previewing a template saw
         something that looked nothing like the document it produces. */
      .doc-page .ProseMirror h1, .doc-page .doc-preview h1 { font-size: 1.85em; font-weight: 700; margin: 0.6em 0 0.35em; letter-spacing: -0.01em; }
      .doc-page .ProseMirror h2, .doc-page .doc-preview h2 { font-size: 1.35em; font-weight: 700; margin: 1.1em 0 0.35em; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      .doc-page .ProseMirror h3, .doc-page .doc-preview h3 { font-size: 1.1em; font-weight: 600; margin: 0.9em 0 0.3em; }
      .doc-page .ProseMirror p, .doc-page .doc-preview p { margin: 0.5em 0; }
      .doc-page .ProseMirror ul, .doc-page .ProseMirror ol,
      .doc-page .doc-preview ul, .doc-page .doc-preview ol { margin: 0.4em 0 0.6em 1.4em; }
      .doc-page .doc-preview ul { list-style: disc; }
      .doc-page .doc-preview ol { list-style: decimal; }
      .doc-page .ProseMirror li, .doc-page .doc-preview li { margin: 0.2em 0; }
      .doc-page .ProseMirror hr, .doc-page .doc-preview hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.4em 0; }
      .doc-page .ProseMirror blockquote, .doc-page .doc-preview blockquote {
        margin: 0.8em 0;
        padding: 0.4em 1em;
        border-left: 3px solid #93c5fd;
        background: #f8fafc;
        color: #334155;
        border-radius: 0 6px 6px 0;
      }
      .doc-page .ProseMirror blockquote p, .doc-page .doc-preview blockquote p { margin: 0.3em 0; }
      .doc-page .ProseMirror strong, .doc-page .doc-preview strong { color: #0f172a; }
      .doc-page .ProseMirror p.is-editor-empty:first-child::before {
        color: #9ca3af;
        content: attr(data-placeholder);
        float: left;
        height: 0;
        pointer-events: none;
      }
      /* Photo slots get the same box model the project page editor gives them
         (styles.css:256-279). Those rules are all scoped to .tiptap, a class
         this surface deliberately does not use - it has its own typography
         above - so without restating them here a "2 photos per page" slot row
         previews STACKED and full-width, while the project page it is authored
         for renders it as a side-by-side pair. Scoped to .doc-page, which
         wraps both the editor and the preview pane.
         The .tiptap-photo selector covers the editor (ProjectImage's NodeView
         wraps each image in that span); the bare img covers the preview, which
         renders the stored HTML directly. Tailwind's preflight sets images to
         display:block, which is what stacks them. */
      .doc-page img { max-width: 100%; border-radius: 6px; }
      .doc-page img[width][height] { object-fit: cover; }
      .doc-page p > img,
      .doc-page p > .tiptap-photo { display: inline-block; vertical-align: top; margin-right: 6px; }
      .doc-page p > img:last-child,
      .doc-page p > .tiptap-photo:last-child { margin-right: 0; }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// Word-style editor surface
// ---------------------------------------------------------------------------
function DocumentEditorSurface({
  editor,
  setEditor,
  saving,
  onSave,
  onClose,
}: {
  editor: EditorState;
  /*
   * The setter itself, not a value-only wrapper: TipTap's onUpdate closure and
   * the header controls both write to this state, and a value update from a
   * stale closure would quietly revert whatever the other one just changed.
   */
  setEditor: Dispatch<SetStateAction<EditorState | null>>;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [previewFill, setPreviewFill] = useState<"token" | "sample">("token");
  const [sidePanel, setSidePanel] = useState(true);
  const [sampleOverrides, setSampleOverrides] = useState<Record<string, string>>({});
  const overridesRef = useRef<Record<string, string>>({});
  overridesRef.current = sampleOverrides;
  const detected = extractFields(editor.body.html);
  const stylePreset = STYLE_PRESETS.find((p) => p.key === editor.body.style) ?? STYLE_PRESETS[0];
  const relevantPlaceholders = useMemo(
    () => getRelevantPlaceholders(editor.body.style, detected),
    [editor.body.style, detected.join("|")],
  );
  // Quick fields = every relevant placeholder for this template type
  // (plus any extras detected in the body). Grid wraps so all stay visible.
  const quickFields = relevantPlaceholders;

  const tiptap = useEditor({
    // Deliberately the same extension set as the project page editor. A
    // template is authored here and rendered there, so anything missing from
    // this list is something a user simply cannot put in their own template -
    // which is why the seeded templates (tables, photo slots, task lists,
    // alignment, colour) were previously impossible to reproduce by hand.
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: "Start writing your document…" }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: false }),
      LinkExtension.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ProjectImage,
      Spacer,
      FillField,
      MergeToken,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      PlaceholderChips.configure({
        getValue: (token: string) => overridesRef.current[token],
      }),
    ],
    content: editor.body.html || "<p></p>",
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      setEditor((prev) => (prev ? { ...prev, body: { ...prev.body, html } } : prev));
    },
  });

  // Sync when switching templates
  useEffect(() => {
    if (!tiptap) return;
    if (tiptap.getHTML() !== (editor.body.html || "<p></p>")) {
      tiptap.commands.setContent(editor.body.html || "<p></p>", {
        emitUpdate: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.template?.id]);

  // Refresh decorations live whenever the Fields panel values change.
  useEffect(() => {
    if (!tiptap) return;
    const { view } = tiptap;
    view.dispatch(view.state.tr.setMeta(placeholderChipsKey, sampleOverrides));
  }, [sampleOverrides, tiptap]);

  function insertPlaceholder(token: string) {
    if (!tiptap) return;
    tiptap.chain().focus().insertContent(`{{${token}}}`).run();
  }

  function insertSection(html: string) {
    if (!tiptap) return;
    tiptap.chain().focus().insertContent(html).run();
  }

  function exportPdf() {
    const html = fillPreview(editor.body.html, "sample");
    const title = editor.name || "Document";
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) {
      toast.error("Popup blocked - allow popups to export.");
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title>
      <style>
        @page { size: Letter; margin: 0.85in; }
        body { font-family: ui-serif, Georgia, "Times New Roman", serif; color: #111827; font-size: 12pt; line-height: 1.6; }
        h1 { font-size: 22pt; margin: 0 0 8pt; }
        h2 { font-size: 15pt; margin: 16pt 0 6pt; border-bottom: 1px solid #e5e7eb; padding-bottom: 4pt; }
        h3 { font-size: 12.5pt; margin: 12pt 0 4pt; }
        p { margin: 6pt 0; }
        ul, ol { margin: 4pt 0 6pt 20pt; }
        hr { border: 0; border-top: 1px solid #e5e7eb; margin: 12pt 0; }
        .doc-chip { display: inline-block; padding: 0 6pt; border-radius: 999pt; font-size: 0.9em; }
        .doc-chip-filled { background: #dcfce7; color: #14532d; border: 1px solid #86efac; }
        .doc-chip-missing { background: #fef3c7; color: #78350f; border: 1px solid #fcd34d; }
      </style></head><body>${html}<script>window.onload=()=>{setTimeout(()=>window.print(),200)};</script></body></html>`);
    win.document.close();
  }

  const wordCount = editor.body.html
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <div className="mx-2 h-6 w-px bg-border" />
        <Input
          value={editor.name}
          onChange={(e) => {
            const name = e.target.value;
            setEditor((prev) => (prev ? { ...prev, name } : prev));
          }}
          className="h-8 max-w-xs font-medium"
          placeholder="Untitled document"
        />
        <Badge variant="secondary" className="hidden gap-1 md:inline-flex">
          <stylePreset.icon className="h-3 w-3" />
          {stylePreset.label}
        </Badge>
        {/* The trade it files under. Saved with the body, so it takes effect on
            Save alongside everything else the editor changes. */}
        <Select
          value={editor.body.category ?? GENERAL_CATEGORY}
          onValueChange={(v) =>
            setEditor((prev) =>
              prev
                ? {
                    ...prev,
                    body: { ...prev.body, category: v === GENERAL_CATEGORY ? undefined : v },
                  }
                : prev,
            )
          }
        >
          <SelectTrigger className="h-8 w-[164px] text-xs" title="Which trade this files under">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GENERAL_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
            {CATEGORY_ORDER.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {stylePreset.description}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden text-xs text-muted-foreground md:block">
            {wordCount} words · {detected.length} placeholder
            {detected.length === 1 ? "" : "s"}
          </div>
          <Button
            variant={sidePanel ? "default" : "outline"}
            size="sm"
            onClick={() => setSidePanel((v) => !v)}
            title="Toggle live fields panel"
          >
            {sidePanel ? (
              <PanelRightClose className="mr-1 h-4 w-4" />
            ) : (
              <PanelRightOpen className="mr-1 h-4 w-4" />
            )}
            Fields
          </Button>
          <Button
            variant={mode === "preview" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode(mode === "edit" ? "preview" : "edit")}
          >
            <Eye className="mr-1 h-4 w-4" />
            {mode === "edit" ? "Preview" : "Back to editor"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf}>
            <Download className="mr-1 h-4 w-4" /> Export PDF
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save template
          </Button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {mode === "preview" ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    {previewFill === "sample"
                      ? "Preview with example values. Real project data fills in when used."
                      : "Preview with placeholders. Each one fills in from the project, or becomes a blank to type into."}
                  </div>
                  <div className="inline-flex rounded-md border bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => setPreviewFill("token")}
                      className={`rounded px-2 py-1 text-xs font-medium transition ${
                        previewFill === "token"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Placeholders
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewFill("sample")}
                      className={`rounded px-2 py-1 text-xs font-medium transition ${
                        previewFill === "sample"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Sample data
                    </button>
                  </div>
                </div>
                <div className="doc-page px-14 py-16">
                  <div
                    className="doc-preview prose prose-neutral max-w-none prose-headings:font-semibold"
                    dangerouslySetInnerHTML={{
                      __html: fillPreview(editor.body.html, previewFill, sampleOverrides),
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="doc-page">
                {/*
                  Quick fields - the narrow-screen home for the same values the
                  Fields panel holds. Editing either updates the matching
                  placeholder in the document live (PlaceholderChips widget
                  decorations); both write the one `sampleOverrides` map.

                  `md:hidden` against the panel's `hidden md:block` is what stops
                  them rendering together, and that pairing is the fix for the
                  screenshot the client sent. Above `md` this strip laid all nine
                  placeholders out in a four-column grid *inside the paper*,
                  directly above a toolbar, while the panel listed the very same
                  nine down the right-hand side - two sets of inputs for one set
                  of values, filling the top third of the window and pushing the
                  document itself below the fold. "Very bad looking. Crowded."

                  The panel wins the wide breakpoint because it is the superset
                  (detected placeholders as well as the suggested ones), it can
                  be dismissed from the header, and it sits beside the document
                  rather than on top of it. This strip wins the narrow one,
                  where the panel is not rendered at all.
                */}
                {quickFields.length > 0 && (
                  <div className="rounded-t-lg border-b border-gray-200 bg-blue-50/60 px-4 py-3 md:hidden">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-900/70">
                      <Sparkles className="h-3 w-3" /> Quick fields
                      <span className="ml-1 font-normal normal-case tracking-normal text-blue-900/50">
                        · edits appear live in the document
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {quickFields.map((p) => (
                        <label key={p.token} className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-medium text-blue-900/70">
                            {p.label}
                          </span>
                          <input
                            className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                            value={sampleOverrides[p.token] ?? ""}
                            placeholder={SAMPLE[p.token] ?? p.label}
                            onChange={(e) =>
                              setSampleOverrides((s) => ({
                                ...s,
                                [p.token]: e.target.value,
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* Formatting toolbar - the same component the project page
                    editor uses, so a template can contain everything a real
                    document can. Project-only actions (insert a project photo,
                    snippets, running header/footer) are omitted: a template has
                    no project behind it and uses photo *slots* instead. */}
                {tiptap && (
                  <div className="sticky top-0 z-20 -mx-px rounded-t-lg border-b border-gray-200 bg-white/95 shadow-sm backdrop-blur">
                    <DocumentToolbar editor={tiptap} />
                    <div className="flex items-center gap-1 border-t border-gray-100 px-3 py-1.5">
                      <SectionMenu onInsert={insertSection} />
                      <PlaceholderMenu onInsert={insertPlaceholder} />
                    </div>
                  </div>
                )}
                <div className="px-14 py-12">
                  <EditorContent editor={tiptap} />
                </div>
              </div>
            )}
          </div>
        </div>
        {sidePanel && mode === "edit" && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l bg-muted/30 md:block">
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Fields for {stylePreset.label}</div>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSidePanel(false)}
                  aria-label="Close panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Suggested placeholders for this template type. Click to insert.
              </p>
              <div className="mb-4 flex flex-wrap gap-1">
                {relevantPlaceholders.map((p) => (
                  <button
                    key={p.token}
                    onClick={() => insertPlaceholder(p.token)}
                    className="rounded-full border bg-white px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                    title={`{{${p.token}}}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Editable fields
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Change any value - the document updates live.
                </p>
                {(() => {
                  const editableTokens = Array.from(
                    new Set([...detected, ...relevantPlaceholders.map((p) => p.token)]),
                  );
                  if (editableTokens.length === 0) {
                    return (
                      <div className="text-xs text-muted-foreground">
                        No placeholders yet. Insert one from above or the toolbar.
                      </div>
                    );
                  }
                  /*
                    One column, not two. The panel is 320px wide, so two columns
                    gave each field about 130px - enough to truncate "Project
                    address" in its own label and to hide the end of whatever was
                    typed into it. Nine of those stacked in a 2-up grid is the
                    right-hand half of the client's screenshot.
                  */
                  return (
                    <div className="space-y-2">
                      {editableTokens.map((token) => (
                        <div key={token} className="space-y-0.5">
                          <label className="text-[11px] font-medium text-muted-foreground">
                            {LABEL_BY_TOKEN[token] ?? token}
                          </label>
                          <input
                            className="w-full rounded border bg-white px-2 py-1 text-sm"
                            value={sampleOverrides[token] ?? ""}
                            onChange={(e) =>
                              setSampleOverrides((s) => ({ ...s, [token]: e.target.value }))
                            }
                            placeholder={SAMPLE[token] ?? token}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <details className="mt-4 rounded-md border bg-white/60 p-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground">
                  All placeholders
                </summary>
                <div className="mt-2 flex flex-wrap gap-1">
                  {PLACEHOLDERS.filter(
                    (p) => !relevantPlaceholders.some((r) => r.token === p.token),
                  ).map((p) => (
                    <button
                      key={p.token}
                      onClick={() => insertPlaceholder(p.token)}
                      className="rounded-full border bg-white px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </details>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function PlaceholderMenu({ onInsert }: { onInsert: (token: string) => void }) {
  const grouped = PLACEHOLDERS.reduce<Record<string, typeof PLACEHOLDERS>>((acc, p) => {
    (acc[p.group] ??= []).push(p);
    return acc;
  }, {});
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Insert placeholder
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {Object.entries(grouped).map(([group, list], idx) => (
          <div key={group}>
            {idx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {group}
            </DropdownMenuLabel>
            {list.map((p) => (
              <DropdownMenuItem
                key={p.token}
                onSelect={(e) => {
                  e.preventDefault();
                  onInsert(p.token);
                }}
                className="flex items-center justify-between gap-3"
              >
                <span>{p.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{p.token}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SECTION_PRESETS: { label: string; description: string; html: string }[] = [
  { label: "Heading", description: "Large section title", html: "<h2>New section</h2><p></p>" },
  { label: "Subheading", description: "Smaller heading", html: "<h3>Subheading</h3><p></p>" },
  { label: "Paragraph", description: "Empty paragraph", html: "<p>Type here…</p>" },
  {
    label: "Bulleted list",
    description: "3-item bullet list",
    html: "<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>",
  },
  {
    label: "Numbered list",
    description: "3-item numbered list",
    html: "<ol><li>Step one</li><li>Step two</li><li>Step three</li></ol>",
  },
  { label: "Divider", description: "Horizontal rule", html: "<hr/><p></p>" },
  {
    label: "Quote / callout",
    description: "Blockquote block",
    html: "<blockquote><p>Important note.</p></blockquote>",
  },
  {
    label: "Photo notes block",
    description: "Header + list",
    html: "<h3>Photo notes</h3><ul><li>Location: </li><li>Observation: </li><li>Recommendation: </li></ul>",
  },
  {
    label: "Action items",
    description: "Task table",
    html: "<h3>Action items</h3><table><thead><tr><th>#</th><th>Item</th><th>Owner</th><th>Due</th></tr></thead><tbody><tr><td>1</td><td></td><td></td><td></td></tr><tr><td>2</td><td></td><td></td><td></td></tr></tbody></table>",
  },
  {
    label: "Signature block",
    description: "Prepared by / signature",
    html: "<hr/><p><strong>Prepared by:</strong> {{prepared_by}}</p><p><strong>Signature:</strong> ______________________</p><p><strong>Date:</strong> {{date}}</p>",
  },
];

function SectionMenu({ onInsert }: { onInsert: (html: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8">
          <LayoutTemplate className="mr-1 h-3.5 w-3.5" /> Add section
          <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Insert section
        </DropdownMenuLabel>
        {SECTION_PRESETS.map((s) => (
          <DropdownMenuItem
            key={s.label}
            onSelect={(e) => {
              e.preventDefault();
              onInsert(s.html);
            }}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="font-medium">{s.label}</span>
            <span className="text-[10px] text-muted-foreground">{s.description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
