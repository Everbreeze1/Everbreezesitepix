import { useEffect, useMemo, useRef, useState } from "react";
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
import { EmptyState } from "@/components/EmptyState";
import {
  SectionHeading,
  SURFACE_BUTTON,
  SURFACE_CARD_INTERACTIVE,
} from "@/components/ui/surface";
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
  LayoutTemplate,
  FilePlus2,
  PanelRightOpen,
  PanelRightClose,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createPageFromTemplate } from "@/lib/project-pages.functions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type DocStyle =
  | "report"
  | "letter"
  | "checklist"
  | "memo"
  | "walkthrough"
  | "sitelog"
  | "sitelog_basic"
  | "sitelog_walkthrough"
  | "sitelog_hvac";

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
  { token: "prepared_by_title", label: "Author title", group: "General" },
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
  sitelog_basic: [
    "project_name",
    "project_address",
    "date",
    "weather",
    "prepared_by",
    "company_name",
  ],
  sitelog_walkthrough: [
    "project_name",
    "project_address",
    "date",
    "weather",
    "prepared_by",
    "client_name",
  ],
  sitelog_hvac: [
    "project_name",
    "project_address",
    "project_number",
    "date",
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
    description: "Formal report with sections and findings.",
    html: `<h1>{{project_name}} — Field Report</h1>
<p><em>{{date}} · Prepared by {{prepared_by}}</em></p>
<h2>Overview</h2>
<p>Summary of site conditions observed at {{project_address}}.</p>
<h2>Findings</h2>
<ul><li>Item one</li><li>Item two</li></ul>
<h2>Recommendations</h2>
<ol><li>First action</li><li>Second action</li></ol>`,
  },
  {
    key: "letter",
    label: "Letter",
    icon: FileSignature,
    description: "Professional letter with header and sign-off.",
    html: `<p>{{date}}</p>
<p>{{client_name}}<br>{{project_address}}</p>
<p><strong>Re: {{project_name}}</strong></p>
<p>Dear {{client_name}},</p>
<p>Write your message here…</p>
<p>Sincerely,</p>
<p>{{prepared_by}}<br>{{prepared_by_title}}<br>{{company_name}}</p>`,
  },
  {
    key: "checklist",
    label: "Checklist summary",
    icon: FileCheck2,
    description: "Recap format for completed checklists.",
    html: `<h1>{{project_name}} — Checklist Summary</h1>
<p><em>Completed {{date}} · {{prepared_by}}</em></p>
<h2>Completed items</h2>
<ul><li>Item one</li><li>Item two</li></ul>
<h2>Outstanding</h2>
<ul><li>Follow-up needed</li></ul>`,
  },
  {
    key: "memo",
    label: "Memo",
    icon: FileText,
    description: "Short internal memo layout.",
    html: `<h1>Memorandum</h1>
<p><strong>To:</strong> {{client_name}}<br>
<strong>From:</strong> {{prepared_by}}<br>
<strong>Date:</strong> {{date}}<br>
<strong>Re:</strong> {{project_name}}</p>
<hr>
<p>Write your memo body here…</p>`,
  },
  {
    key: "walkthrough",
    label: "Walkthrough report",
    icon: Footprints,
    description: "Structured walkthrough with observations by area.",
    html: `<h1>{{project_name}} — Walkthrough Report</h1>
<p><em>{{date}} · Led by {{prepared_by}} · Weather: {{weather}}</em></p>
<h2>Attendees</h2>
<ul><li>{{prepared_by}} ({{prepared_by_title}})</li><li>{{client_name}}</li></ul>
<h2>Route & Observations</h2>
<h3>Area 1</h3>
<p>Describe conditions, progress, and any concerns observed.</p>
<h3>Area 2</h3>
<p>Describe conditions, progress, and any concerns observed.</p>
<h2>Action Items</h2>
<ol><li>Follow-up task one</li><li>Follow-up task two</li></ol>
<h2>Next Steps</h2>
<p>Summarize the plan through the next walkthrough.</p>`,
  },
  {
    key: "sitelog",
    label: "Site log",
    icon: ClipboardList,
    description: "Daily site log with crew, work performed, and notes.",
    html: `<h1>{{project_name}}</h1>
<p><strong>Daily Site Log</strong> · {{date}}</p>
<p><em>Prepared by {{prepared_by}}, {{prepared_by_title}} · {{company_name}}</em></p>
<hr>
<h2>Site conditions</h2>
<p><strong>Location:</strong> {{project_address}}<br>
<strong>Weather:</strong> {{weather}}<br>
<strong>Project #:</strong> {{project_number}}</p>
<h2>Crew on site</h2>
<ul>
  <li>Trade / company — number of workers — hours</li>
  <li>Trade / company — number of workers — hours</li>
</ul>
<h2>Work performed today</h2>
<ol>
  <li>Describe the first task completed and its location.</li>
  <li>Describe the second task completed and its location.</li>
  <li>Describe any inspections or milestones reached.</li>
</ol>
<h2>Deliveries & equipment</h2>
<ul>
  <li>Material or equipment — supplier — quantity</li>
</ul>
<h2>Issues, delays & safety</h2>
<blockquote><p>Record any RFIs, blockers, incidents, or safety observations here. Note who was informed and the follow-up action taken.</p></blockquote>
<h2>Photos referenced</h2>
<p>List key photos captured today with brief captions.</p>
<h2>Plan for tomorrow</h2>
<ul>
  <li>Priority task and responsible trade</li>
  <li>Coordination items or deliveries expected</li>
</ul>
<hr>
<p><em>Signed: {{prepared_by}} — {{date}}</em></p>`,
  },
  {
    key: "sitelog_basic",
    label: "Basic site log (sample)",
    icon: ClipboardList,
    description: "Simple daily summary with photos and notes.",
    html: `<h1>{{project_name}}</h1>
<p><strong>Daily Site Log</strong> — {{date}}</p>
<p><em>{{prepared_by}} · {{company_name}}</em></p>
<hr>
<h2>Summary</h2>
<p>Brief overview of what happened on site today at {{project_address}}. Weather was {{weather}}.</p>
<h2>Work completed</h2>
<ul>
  <li>Task one — location / trade</li>
  <li>Task two — location / trade</li>
  <li>Task three — location / trade</li>
</ul>
<h2>Photos &amp; notes</h2>
<blockquote><p>Attach the day's photos and add a short caption for each. Highlight anything worth flagging for the client or the team.</p></blockquote>
<h2>Notes for tomorrow</h2>
<p>Anything the crew or client should know before the next shift.</p>
<hr>
<p><em>Prepared by {{prepared_by}} — {{date}}</em></p>`,
  },
  {
    key: "sitelog_walkthrough",
    label: "Detailed walkthrough log (sample)",
    icon: Footprints,
    description: "Structured walkthrough with findings, action items, and photo notes.",
    html: `<h1>{{project_name}} — Walkthrough Log</h1>
<p><strong>Date:</strong> {{date}} · <strong>Weather:</strong> {{weather}}</p>
<p><strong>Led by:</strong> {{prepared_by}}, {{prepared_by_title}} · <strong>Client:</strong> {{client_name}}</p>
<p><strong>Location:</strong> {{project_address}} · <strong>Project #:</strong> {{project_number}}</p>
<hr>
<h2>1. Attendees</h2>
<ul>
  <li>{{prepared_by}} — {{prepared_by_title}} ({{company_name}})</li>
  <li>{{client_name}} — Owner representative</li>
  <li>Additional attendee — role</li>
</ul>
<h2>2. Scope of walkthrough</h2>
<p>Describe the areas covered, the purpose of the visit, and any specific items requested by the client.</p>
<h2>3. Findings by area</h2>
<h3>Area A — e.g. Ground floor</h3>
<ul>
  <li><strong>Observation:</strong> what was seen</li>
  <li><strong>Status:</strong> on track / delayed / needs attention</li>
</ul>
<h3>Area B — e.g. Mechanical room</h3>
<ul>
  <li><strong>Observation:</strong> what was seen</li>
  <li><strong>Status:</strong> on track / delayed / needs attention</li>
</ul>
<h2>4. Photo notes</h2>
<blockquote><p>Reference each photo by number and add a one-line caption describing what it shows and why it matters.</p></blockquote>
<ol>
  <li>Photo 1 — caption</li>
  <li>Photo 2 — caption</li>
  <li>Photo 3 — caption</li>
</ol>
<h2>5. Action items</h2>
<ol>
  <li>Action — <strong>Owner:</strong> name — <strong>Due:</strong> date</li>
  <li>Action — <strong>Owner:</strong> name — <strong>Due:</strong> date</li>
</ol>
<h2>6. Next walkthrough</h2>
<p>Proposed date, attendees, and focus areas for the next visit.</p>
<hr>
<p><em>Signed: {{prepared_by}} — {{date}}</em></p>`,
  },
  {
    key: "sitelog_hvac",
    label: "HVAC / construction log (sample)",
    icon: FileCheck2,
    description: "Technical observations, system progress, and recommendations.",
    html: `<h1>{{project_name}} — HVAC / Construction Log</h1>
<p><strong>Date:</strong> {{date}} · <strong>Project #:</strong> {{project_number}}</p>
<p><strong>Inspector:</strong> {{prepared_by}}, {{prepared_by_title}} · {{company_name}}</p>
<p><strong>Site:</strong> {{project_address}} · <strong>Conditions:</strong> {{weather}}</p>
<hr>
<h2>1. Systems inspected</h2>
<ul>
  <li>Air handling unit(s) — location / tag</li>
  <li>Ductwork run(s) — floor / zone</li>
  <li>Piping / refrigerant lines — segment</li>
  <li>Controls &amp; thermostats — zone</li>
</ul>
<h2>2. Technical observations</h2>
<h3>Mechanical</h3>
<ul>
  <li>Component — measurement / reading — status</li>
  <li>Component — measurement / reading — status</li>
</ul>
<h3>Electrical &amp; controls</h3>
<ul>
  <li>Panel / circuit — observation</li>
  <li>Sensor / control — observation</li>
</ul>
<h3>Structural / rough-in</h3>
<ul>
  <li>Framing, penetrations, hangers — observation</li>
</ul>
<h2>3. Progress vs. schedule</h2>
<blockquote><p>Summarize percent complete for each system and call out anything ahead of or behind the baseline schedule.</p></blockquote>
<ol>
  <li>HVAC rough-in — % complete — on track / behind</li>
  <li>Duct insulation — % complete — on track / behind</li>
  <li>Startup &amp; commissioning — % complete — on track / behind</li>
</ol>
<h2>4. Deficiencies &amp; safety</h2>
<ul>
  <li>Deficiency — location — severity — corrective action</li>
  <li>Safety observation — corrective action</li>
</ul>
<h2>5. Recommendations</h2>
<ol>
  <li>Recommendation — responsible party — target date</li>
  <li>Recommendation — responsible party — target date</li>
</ol>
<h2>6. Photos referenced</h2>
<p>Attach labeled photos of each system inspected, with tags matching the observations above.</p>
<hr>
<p><em>Report prepared by {{prepared_by}} ({{prepared_by_title}}) — {{date}}</em></p>`,
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
    };
  }
  return { style: "report", html: "", description: "" };
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

// ---------------------------------------------------------------------------
// Placeholder decoration — styles {{token}} as an editable pill in the editor.
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
                        span.setAttribute("title", `${label} — live value from Fields panel`);
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
                      title: `${label} — editable placeholder`,
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
  const [editor, setEditor] = useState<{
    template: DocumentTemplate | null;
    name: string;
    body: DocBody;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStyle, setNewStyle] = useState<DocStyle>("report");
  /** Template awaiting a project to be applied to. */
  const [useFor, setUseFor] = useState<DocumentTemplate | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; location: string | null }>>(
    [],
  );
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [applying, setApplying] = useState(false);

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

  const applyToProject = async (projectId: string) => {
    if (!useFor) return;
    setApplying(true);
    try {
      const res = await createPageFromTemplate({
        data: { projectId, templateId: useFor.id },
      });
      setUseFor(null);
      // Straight into the new page: the point of "use" is to end up editing the
      // document, not back on a settings screen wondering if it worked.
      navigate({
        to: "/projects/$projectId/pages/$pageId",
        params: { projectId, pageId: res.page.id },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not use this template");
    } finally {
      setApplying(false);
    }
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

  const visible = useMemo(
    () => items.filter((i) => (showArchived ? true : !i.archived)),
    [items, showArchived],
  );

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
    setItems((prev) => [data as unknown as DocumentTemplate, ...prev]);
    setEditor({
      template: data as unknown as DocumentTemplate,
      name: (data as unknown as DocumentTemplate).name,
      body: parseBody((data as unknown as DocumentTemplate).body),
    });
  }

  async function loadSampleSiteLogs() {
    const sampleKeys: DocStyle[] = ["sitelog_basic", "sitelog_walkthrough", "sitelog_hvac"];
    const rows = sampleKeys
      .map((k) => STYLE_PRESETS.find((p) => p.key === k)!)
      .map((p) => ({
        name: p.label.replace(" (sample)", ""),
        team_id: teamId,
        created_by: user?.id,
        body: { style: p.key, html: p.html, description: p.description } as any,
        fields: extractFields(p.html),
      }));
    const { data, error } = await supabase
      .from("document_templates" as any)
      .insert(rows)
      .select();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Sample site log templates added");
    setItems((prev) => [...((data ?? []) as unknown as DocumentTemplate[]), ...prev]);
  }

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

  async function duplicate(t: DocumentTemplate) {
    const { data, error } = await supabase
      .from("document_templates" as any)
      .insert({
        // Never inherit a null team_id from an example — the copy must belong
        // to the caller's team so it is editable.
        name: `${t.name} (copy)`,
        team_id: teamId ?? null,
        created_by: user?.id,
        body: t.body,
        fields: t.fields,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setItems((prev) => [data as unknown as DocumentTemplate, ...prev]);
    toast.success("Duplicated");
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
    if (!(await confirm({ description: `Delete "${t.name}"? This can't be undone.`, variant: "destructive" }))) return;
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
              <Button variant="outline" className={SURFACE_BUTTON} onClick={loadSampleSiteLogs}>
                <Sparkles className="h-4 w-4" /> Load sample site logs
              </Button>
            )}
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
        <div>
          <p className="font-semibold">How to use a template</p>
          <p className="mt-0.5 text-blue-900/80 dark:text-blue-200/80">
            Hit <strong>Use in a project</strong> on any template below and pick the job — the
            document is created with its fields already filled in. They&rsquo;re also available
            inside a project under <strong>Documents → Create → More Templates</strong>.
          </p>
        </div>
      </div>

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => {
            const body = parseBody(t.body);
            const preset = STYLE_PRESETS.find((p) => p.key === body.style) ?? STYLE_PRESETS[0];
            const Icon = preset.icon;
            // Built-in examples (no team, no owner) are read-only for everyone —
            // RLS rejects writes to them, so only Duplicate is offered.
            const isExample = t.team_id === null;
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
                    </div>
                  </div>
                  {isExample ? (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      Example
                    </Badge>
                  ) : t.archived ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Archived
                    </Badge>
                  ) : null}
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground line-clamp-3">
                  {body.html
                    .replace(/<[^>]+>/g, " ")
                    .trim()
                    .slice(0, 180) || "Empty document"}
                </div>
                <div className="mt-auto flex flex-wrap gap-1 border-t border-border/60 pt-3">
                  {/* The primary verb. Without it the Templates page could only
                      author templates, never apply one — which is exactly why
                      "not sure how to use that template again" came back as
                      feedback. Available on examples too: using one doesn't
                      write to it, so the read-only rule doesn't apply. */}
                  <Button size="sm" onClick={() => openUse(t)}>
                    <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Use in a project
                  </Button>
                  {canManage && !isExample && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setEditor({
                          template: t,
                          name: t.name,
                          body: parseBody(t.body),
                        })
                      }
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant={isExample ? "outline" : "ghost"}
                      onClick={() => duplicate(t)}
                    >
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      {isExample ? "Duplicate to edit" : "Duplicate"}
                    </Button>
                  )}
                  {canManage && !isExample && (
                    <Button size="sm" variant="ghost" onClick={() => toggleArchive(t)}>
                      {t.archived ? (
                        <>
                          <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Restore
                        </>
                      ) : (
                        <>
                          <Archive className="mr-1 h-3.5 w-3.5" /> Archive
                        </>
                      )}
                    </Button>
                  )}
                  {canManage && !isExample && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(t)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Use-in-a-project picker */}
      <Dialog open={!!useFor} onOpenChange={(o) => !o && setUseFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate">Use “{useFor?.name}”</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pick a project and we&rsquo;ll create the document there with its fields already
            filled in from that project.
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
                  disabled={applying}
                  onClick={() => applyToProject(p.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-accent disabled:opacity-60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{p.name}</p>
                    {p.location && (
                      <p className="truncate text-xs text-muted-foreground">{p.location}</p>
                    )}
                  </div>
                  {applying ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <FilePlus2 className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Editor — full-screen Word-like surface */}
      <Dialog
        open={!!editor}
        onOpenChange={(v) => {
          if (!v) setEditor(null);
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
              onClose={() => setEditor(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
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
      /* Editor: style the raw {{token}} text as a pill — still fully editable */
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
      .doc-page .ProseMirror h1 { font-size: 1.85em; font-weight: 700; margin: 0.6em 0 0.35em; letter-spacing: -0.01em; }
      .doc-page .ProseMirror h2 { font-size: 1.35em; font-weight: 700; margin: 1.1em 0 0.35em; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      .doc-page .ProseMirror h3 { font-size: 1.1em; font-weight: 600; margin: 0.9em 0 0.3em; }
      .doc-page .ProseMirror p { margin: 0.5em 0; }
      .doc-page .ProseMirror ul, .doc-page .ProseMirror ol { margin: 0.4em 0 0.6em 1.4em; }
      .doc-page .ProseMirror li { margin: 0.2em 0; }
      .doc-page .ProseMirror hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.4em 0; }
      .doc-page .ProseMirror blockquote {
        margin: 0.8em 0;
        padding: 0.4em 1em;
        border-left: 3px solid #93c5fd;
        background: #f8fafc;
        color: #334155;
        border-radius: 0 6px 6px 0;
      }
      .doc-page .ProseMirror blockquote p { margin: 0.3em 0; }
      .doc-page .ProseMirror strong { color: #0f172a; }
      .doc-page .ProseMirror p.is-editor-empty:first-child::before {
        color: #9ca3af;
        content: attr(data-placeholder);
        float: left;
        height: 0;
        pointer-events: none;
      }
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
  editor: { template: DocumentTemplate | null; name: string; body: DocBody };
  setEditor: (v: { template: DocumentTemplate | null; name: string; body: DocBody }) => void;
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
    // this list is something a user simply cannot put in their own template —
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
      setEditor({ ...editor, body: { ...editor.body, html } });
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
      toast.error("Popup blocked — allow popups to export.");
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
          onChange={(e) => setEditor({ ...editor, name: e.target.value })}
          className="h-8 max-w-xs font-medium"
          placeholder="Untitled document"
        />
        <Badge variant="secondary" className="hidden gap-1 md:inline-flex">
          <stylePreset.icon className="h-3 w-3" />
          {stylePreset.label}
        </Badge>
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
                      : "Preview with placeholders. They stay as {{tokens}} until applied to a project."}
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
                    className="prose prose-neutral max-w-none prose-headings:font-semibold"
                    dangerouslySetInnerHTML={{
                      __html: fillPreview(editor.body.html, previewFill, sampleOverrides),
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="doc-page">
                {/* Quick fields — side-by-side inputs above the document.
                  Editing here instantly updates the matching placeholder in
                  the document body (via PlaceholderChips widget decorations). */}
                {quickFields.length > 0 && (
                  <div className="rounded-t-lg border-b border-gray-200 bg-blue-50/60 px-4 py-3">
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
                {/* Formatting toolbar — the same component the project page
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
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-muted/30 md:block">
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
                  Change any value — the document updates live.
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
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {editableTokens.map((token) => (
                        <div key={token} className="space-y-0.5">
                          <label className="text-[10px] font-medium text-muted-foreground">
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
