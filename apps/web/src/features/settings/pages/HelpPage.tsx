import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Camera,
  ClipboardCheck,
  Workflow,
  Video,
  FileText,
  Users,
  LayoutTemplate,
  Sparkles,
  Map as MapIcon,
  Settings,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

type Guide = {
  id: string;
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
};

type Category = {
  id: string;
  title: string;
  icon: LucideIcon;
  blurb: string;
  guides: Guide[];
};

const CATEGORIES: Category[] = [
  {
    id: "photos",
    title: "Photo capture & tagging",
    icon: Camera,
    blurb: "Snap, annotate, geotag, and organize photos.",
    guides: [
      {
        id: "capture",
        title: "Capture photos on site",
        summary: "Take photos from any project without leaving the app.",
        steps: [
          "Open a project and tap the floating camera button in the bottom-right.",
          "Snap one or more shots - each is geotagged and timestamped automatically.",
          "Add an optional caption or voice note before saving.",
          "Photos sync in the background; you can keep shooting offline.",
        ],
        tips: ["Long-press the camera button to record video instead of a still."],
      },
      {
        id: "annotate",
        title: "Annotate & mark up a photo",
        summary: "Draw arrows, circles, and text directly on any photo.",
        steps: [
          "Open the photo in the lightbox from the Gallery or project view.",
          "Click the pencil icon to enter the annotator.",
          "Pick a color and tool (arrow, box, freehand, text), draw, then Save.",
          "The annotated copy replaces the thumbnail; the original is kept.",
        ],
      },
      {
        id: "tags",
        title: "Tag photos & bulk-tag",
        summary: "Group photos by trade, area, or custom label.",
        steps: [
          "Select one or more photos and click Tag in the action bar.",
          "Pick existing tags or create a new one (colors are auto-assigned).",
          "Filter the Gallery by tag using the chips at the top.",
        ],
        tips: ["Manage the full tag catalog in Account → Labels & tags."],
      },
    ],
  },
  {
    id: "checklists",
    title: "Checklists",
    icon: ClipboardCheck,
    blurb: "Simple task lists for QA, punch, and safety walks.",
    guides: [
      {
        id: "apply-checklist",
        title: "Apply a checklist to a project",
        summary: "Use a saved template or start from scratch.",
        steps: [
          "From a project page, open the Checklists tab.",
          "Click New checklist → pick a template or Blank.",
          "Assign items to teammates and check them off as you complete work.",
        ],
      },
      {
        id: "create-checklist-template",
        title: "Create a reusable checklist template",
        summary: "Save a checklist so your whole team can apply it to any project.",
        steps: [
          "Go to Templates (sidebar) → Checklists → New template.",
          "Name the template and add items. Set an item type (text, photo required, sign-off).",
          "Click Save. The template is now available on every project.",
        ],
      },
    ],
  },
  {
    id: "workflows",
    title: "Workflows",
    icon: Workflow,
    blurb: "Multi-phase standardized processes with sign-offs.",
    guides: [
      {
        id: "workflow-vs-checklist",
        title: "Workflows vs Checklists - what's the difference?",
        summary: "Both track work; workflows add structure.",
        steps: [
          "Checklists are a single flat task list - good for QA or punch items.",
          "Workflows are multi-phase processes (e.g. Install: Site Assessment → Removal → Installation → Testing → Sign-off).",
          "Each workflow phase can contain its own checklists, required photos, and sign-offs.",
        ],
      },
      {
        id: "create-workflow",
        title: "Create a workflow template",
        summary: "Design a repeatable multi-step job process.",
        steps: [
          "Go to Templates → Workflows → New workflow.",
          "Name the workflow, then add phases in order.",
          "In each phase, add checklist items, required photos, and sign-offs.",
          "Click Save to publish. Apply it to any project from the Workflows tab.",
        ],
      },
      {
        id: "track-workflow",
        title: "Track workflow progress on a project",
        summary: "Move through phases as work is completed.",
        steps: [
          "Open a project → Workflows tab and select the active workflow.",
          "Complete items inside the current phase.",
          "When a phase is fully complete, mark it done to unlock the next one.",
        ],
      },
    ],
  },
  {
    id: "walkthroughs",
    title: "Walkthroughs",
    icon: Video,
    blurb: "Narrated video tours of a job site.",
    guides: [
      {
        id: "record-walkthrough",
        title: "Record a walkthrough",
        summary: "Capture a narrated video tour of the site.",
        steps: [
          "From a project, open Walkthroughs → New walkthrough.",
          "Allow camera & microphone access and start recording.",
          "Narrate as you walk; tap Stop when finished.",
          "The walkthrough uploads automatically and generates a shareable link.",
        ],
      },
      {
        id: "share-walkthrough",
        title: "Share a walkthrough with a client",
        summary: "Send a link - no login required.",
        steps: [
          "Open the walkthrough and click Share.",
          "Copy the public link and send it via email or text.",
          "Clients can view (and download a PDF summary) without signing up.",
        ],
      },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    icon: FileText,
    blurb: "Client-ready PDFs from photos, notes, and checklists.",
    guides: [
      {
        id: "create-report",
        title: "Create a report",
        summary: "Turn project photos and notes into a branded PDF.",
        steps: [
          "From a project → Reports tab → New report.",
          "Pick photos, add sections, and drag to reorder.",
          "Let AI auto-draft captions and summaries if you want.",
          "Preview, then Save. Share via link or download as PDF.",
        ],
      },
      {
        id: "auto-report",
        title: "AI-generated site logs & walkthrough reports",
        summary: "Let AI draft a first pass for you.",
        steps: [
          "In a project's Documents tab, open Site Logs and pick photos.",
          "AI scans photos, tags, and any voice notes and drafts a structured recap.",
          "Review, edit any section, and export a branded PDF.",
        ],
      },
    ],
  },
  {
    id: "templates",
    title: "Templates",
    icon: LayoutTemplate,
    blurb: "Central library for reusable checklists and workflows.",
    guides: [
      {
        id: "templates-hub",
        title: "Templates hub",
        summary: "One place to manage every template your team uses.",
        steps: [
          "Open Templates in the sidebar.",
          "Tabs: Checklists, Workflows, Reports.",
          "Create, edit, duplicate, or delete templates here.",
          "You can also create & edit templates directly from any project - you'll be returned to the project when you save.",
        ],
      },
    ],
  },
  {
    id: "teams",
    title: "Team collaboration",
    icon: Users,
    blurb: "Invite crew, assign roles, and share work.",
    guides: [
      {
        id: "invite",
        title: "Invite a teammate",
        summary: "Add a crew member to your account.",
        steps: [
          "Go to Your Company → Team Members.",
          "Click Invite and enter their email.",
          "Pick a role: Owner, Admin, Member, or Viewer.",
          "They'll get an email invite to join your workspace.",
        ],
      },
      {
        id: "roles",
        title: "Roles & permissions",
        summary: "Control who can create, edit, and share.",
        steps: [
          "Owner: full access, billing.",
          "Admin: manage projects, templates, team members.",
          "Member: work on projects they're added to.",
          "Viewer: read-only.",
        ],
      },
    ],
  },
  {
    id: "ai",
    title: "Breeze AI assistant",
    icon: Sparkles,
    blurb: "Ask questions about your photos and projects.",
    guides: [
      {
        id: "ai-usage",
        title: "Ask Breeze about a project",
        summary: "Natural-language Q&A across your photos.",
        steps: [
          "Open Breeze from the sidebar.",
          "Pick a project scope or ask across all projects.",
          "Try questions like 'What hazards did we photograph this week?' or 'List every model number from the panel photos.'",
        ],
      },
    ],
  },
  {
    id: "map",
    title: "Map & Gallery",
    icon: MapIcon,
    blurb: "See projects on a map, browse all photos in one place.",
    guides: [
      {
        id: "map",
        title: "Use the Map view",
        summary: "See every project pinned to its address.",
        steps: [
          "Open Maps from the sidebar.",
          "Click a pin to jump to that project.",
          "Filter by team member, status, or tag.",
        ],
      },
      {
        id: "gallery",
        title: "Browse the Gallery",
        summary: "Cross-project photo grid with filters.",
        steps: [
          "Open Gallery from the sidebar.",
          "Filter by project, tag, date, or captured-by.",
          "Select photos to bulk-tag, move, share, or delete.",
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Account & settings",
    icon: Settings,
    blurb: "Profile, notifications, appearance, security.",
    guides: [
      {
        id: "profile",
        title: "Update your profile",
        summary: "Change your name, photo, phone, or job title.",
        steps: ["Open Account (sidebar) → Profile.", "Edit fields and click Save."],
      },
      {
        id: "notifications",
        title: "Manage notifications",
        summary: "Control what you're pinged about.",
        steps: [
          "Account → Notifications.",
          "Toggle email and in-app notifications per event type.",
        ],
      },
    ],
  },
];

const ALL_GUIDE_IDS = CATEGORIES.flatMap((c) => c.guides.map((g) => g.id));
const TOTAL_GUIDES = ALL_GUIDE_IDS.length;

/** Everything a guide can be matched on, lowercased once per render pass. */
function guideHaystack(g: Guide): string {
  return [g.title, g.summary, ...g.steps, ...(g.tips ?? [])].join(" ").toLowerCase();
}

export function HelpPage() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string[]>([]);

  const q = query.trim().toLowerCase();

  /** Categories with non-matching guides removed; empty categories drop out. */
  const results = useMemo(() => {
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => {
      // A category-level match (its own title/blurb) keeps all of its guides,
      // so searching "workflows" shows the whole section rather than nothing.
      const catMatches = `${cat.title} ${cat.blurb}`.toLowerCase().includes(q);
      const guides = catMatches
        ? cat.guides
        : cat.guides.filter((g) => guideHaystack(g).includes(q));
      return { ...cat, guides };
    }).filter((cat) => cat.guides.length > 0);
  }, [q]);

  const matchCount = results.reduce((n, c) => n + c.guides.length, 0);

  // Searching auto-opens what matched - the answer should be on screen, not
  // one more click away.
  useEffect(() => {
    if (!q) return;
    setOpen(results.flatMap((c) => c.guides.map((g) => g.id)));
  }, [q, results]);

  // Deep links (/help#annotate) still work: open that guide and scroll to it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id || !ALL_GUIDE_IDS.includes(id)) return;
    setOpen((prev) => (prev.includes(id) ? prev : [...prev, id]));
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "center" });
    });
  }, []);

  const allOpen = open.length >= TOTAL_GUIDES;

  return (
    <div className="p-10">
      <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
        Support
      </p>
      <h1 className="font-display mt-3 text-[38.4px] font-bold leading-9 tracking-[-1.34px] text-foreground">
        Help center
      </h1>
      <p className="font-manrope mt-3 max-w-[576px] text-sm leading-6 text-muted-foreground">
        Guides, tips, and answers for every SitePix workflow.
      </p>

      {/*
        One scannable list rather than three copies of the same navigation.
        This page previously showed 3 shortcut cards, then 10 category cards,
        then every one of the 20 guides fully expanded - so finding an answer
        meant scrolling past all of them. Topics are now collapsed by default
        and open in place.
      */}
      <div className="mt-8 max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help - e.g. “annotate”, “PDF”, “offline”…"
              className="h-11 rounded-xl pl-9 pr-9 text-sm font-medium"
              aria-label="Search help topics"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0 rounded-xl text-xs font-bold"
            onClick={() => setOpen(allOpen ? [] : ALL_GUIDE_IDS)}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>

        <p className="font-manrope mt-3 text-xs font-semibold text-muted-foreground">
          {q
            ? `${matchCount} ${matchCount === 1 ? "topic" : "topics"} matching “${query.trim()}”`
            : `${TOTAL_GUIDES} topics across ${CATEGORIES.length} categories`}
        </p>

        {results.length === 0 ? (
          <div className="mt-8 rounded-2xl border-[0.8px] border-dashed border-border bg-card/60 p-10 text-center">
            <p className="font-manrope text-sm font-bold text-foreground">No topics match that.</p>
            <p className="font-manrope mt-1 text-sm text-muted-foreground">
              Try a different word, or clear the search to browse everything.
            </p>
            <Button
              variant="outline"
              className="mt-4 rounded-xl text-xs font-bold"
              onClick={() => setQuery("")}
            >
              Clear search
            </Button>
          </div>
        ) : (
          <Accordion
            type="multiple"
            value={open}
            onValueChange={setOpen}
            className="mt-6 space-y-8"
          >
            {results.map((cat) => (
              <section key={cat.id} id={cat.id} className="scroll-mt-24">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <cat.icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-manrope text-base font-bold tracking-[-0.3px] text-foreground">
                      {cat.title}
                    </h2>
                    <p className="font-manrope text-xs text-muted-foreground">{cat.blurb}</p>
                  </div>
                </div>

                <div className="mt-3 overflow-hidden rounded-2xl border-[0.8px] border-border bg-card/[0.82]">
                  {cat.guides.map((g) => (
                    <AccordionItem
                      key={g.id}
                      value={g.id}
                      id={g.id}
                      className="scroll-mt-24 border-b-[0.8px] border-border px-5 last:border-b-0"
                    >
                      <AccordionTrigger className="gap-4 py-4 hover:no-underline">
                        <span className="min-w-0 text-left">
                          <span className="font-manrope block text-sm font-bold text-foreground">
                            {g.title}
                          </span>
                          <span className="font-manrope mt-0.5 block text-xs text-muted-foreground">
                            {g.summary}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-5">
                        <ol className="font-manrope ml-4 list-decimal space-y-2 text-sm leading-relaxed text-muted-foreground">
                          {g.steps.map((s, i) => (
                            <li key={i} className="pl-1">
                              {s}
                            </li>
                          ))}
                        </ol>
                        {g.tips && g.tips.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {g.tips.map((t, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm"
                              >
                                <span className="font-manrope mt-0.5 shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">
                                  Tip
                                </span>
                                <span className="font-manrope text-muted-foreground">{t}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </div>
              </section>
            ))}
          </Accordion>
        )}
      </div>

      <div className="mt-8 max-w-4xl rounded-2xl border-[0.8px] border-border bg-card/60 p-6 text-center">
        <h3 className="font-manrope text-base font-bold text-foreground">
          Can't find what you need?
        </h3>
        <p className="font-manrope mt-1 text-sm text-muted-foreground">
          Head to Account → Chat with support, or use the Report issue button in the sidebar.
        </p>
        <Link
          to="/settings"
          className="font-manrope mt-3 inline-block text-sm font-bold text-primary hover:underline"
        >
          Go to Support settings →
        </Link>
      </div>
    </div>
  );
}
