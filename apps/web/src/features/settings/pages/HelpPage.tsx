import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Camera,
  CheckSquare,
  ClipboardCheck,
  FolderKanban,
  FolderOpen,
  Workflow,
  Video,
  FileText,
  Layers,
  Users,
  LayoutTemplate,
  Sparkles,
  Map as MapIcon,
  Settings,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  HELP_CATEGORIES,
  HELP_GUIDE_IDS,
  helpGuideHaystack,
  type HelpCategory,
  type HelpIconId,
} from "@everlumen/shared/help-guides";

/*
 * The guides themselves live in packages/shared/src/help-guides.ts, so the
 * field app shows the same Knowledge Base natively. Read the notes at the top
 * of that file before editing an article: they list the ways articles go stale.
 */
const HELP_ICONS: Record<HelpIconId, LucideIcon> = {
  "folder-kanban": FolderKanban,
  camera: Camera,
  "check-square": CheckSquare,
  "clipboard-check": ClipboardCheck,
  workflow: Workflow,
  video: Video,
  "file-text": FileText,
  "folder-open": FolderOpen,
  "layout-template": LayoutTemplate,
  users: Users,
  layers: Layers,
  sparkles: Sparkles,
  map: MapIcon,
  settings: Settings,
};

type Category = Omit<HelpCategory, "icon"> & { icon: LucideIcon };

const CATEGORIES: Category[] = HELP_CATEGORIES.map((c) => ({ ...c, icon: HELP_ICONS[c.icon] }));

const ALL_GUIDE_IDS: string[] = [...HELP_GUIDE_IDS];
const TOTAL_GUIDES = ALL_GUIDE_IDS.length;

/** Everything a guide can be matched on, lowercased once per render pass. */
const guideHaystack = helpGuideHaystack;

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

  // Which category the reader is currently inside, so the rail can mark it.
  // The top margin matches the 56px sticky header plus a little breathing room,
  // so a section counts as "current" once it clears the header rather than the
  // moment it touches the top of the window.
  const [activeCat, setActiveCat] = useState("");
  useEffect(() => {
    const sections = results
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        // Topmost visible section wins, so scrolling up highlights the same
        // row that scrolling down did.
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setActiveCat(top.target.id);
      },
      { rootMargin: "-72px 0px -70% 0px" },
    );
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [results]);

  const allOpen = open.length >= TOTAL_GUIDES;

  return (
    /*
      One centred column, like Settings. This page used to be a bare `p-10`
      with a `max-w-4xl` block inside it, which pinned every word to the left
      edge and left a third of a desktop window empty. Now the page centres in
      the shell, and on xl the width that is left over carries the category
      rail instead of nothing.
    */
    <div className="mx-auto w-full max-w-[1192px] px-6 pb-24 pt-10 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[560px]">
          <h1 className="font-sans text-2xl font-bold tracking-[-0.01em] text-foreground">
            Knowledge Base
          </h1>
          <p className="font-sans mt-1 text-[13.5px] leading-snug text-muted-foreground">
            Guides for getting the most out of Everlumen.
          </p>
        </div>
      </div>

      {/*
        One scannable list rather than three copies of the same navigation.
        This page previously showed 3 shortcut cards, then 10 category cards,
        then every one of the 20 guides fully expanded - so finding an answer
        meant scrolling past all of them. Topics are now collapsed by default
        and open in place.
      */}
      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_236px] xl:items-start">
        <div className="min-w-0 max-w-4xl xl:max-w-none">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help - e.g. “blueprint”, “roles”, “tasks”…"
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
              <p className="font-manrope text-sm font-bold text-foreground">
                No topics match that.
              </p>
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
                      <h2 className="font-manrope text-base font-bold tracking-[-0.01em] text-foreground">
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

          {/* Points at Feedback, which is where support actually is. Rendered
              as the reference's amber "Still stuck?" CTA band. */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[12px] bg-primary/10 px-5 py-[18px] sm:px-6">
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-bold text-foreground">Still stuck?</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Send us a note from the Feedback page and we'll follow up.
              </p>
            </div>
            <Link
              to="/report-issue"
              className="inline-flex shrink-0 items-center rounded-lg bg-primary px-4 py-2 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Go to Feedback
            </Link>
          </div>
        </div>

        {/*
          The rail is what the empty right-hand third becomes: 14 categories,
          each one a jump link, with the guide count and the section you are
          currently reading marked. It only appears at xl, where there is room
          for it beside a comfortable line length - below that the page falls
          back to the single column it has always been.
        */}
        {results.length > 0 && (
          <nav aria-label="Help categories" className="hidden xl:sticky xl:top-[98px] xl:block">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
              Categories
            </p>
            <ul className="mt-3 space-y-0.5 border-l-[0.8px] border-border">
              {results.map((cat) => (
                <li key={cat.id}>
                  <a
                    href={`#${cat.id}`}
                    onClick={() => setActiveCat(cat.id)}
                    className={cn(
                      "font-manrope -ml-px flex items-center gap-2 border-l-2 py-1.5 pl-3 text-xs transition-colors",
                      activeCat === cat.id
                        ? "border-primary font-bold text-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <cat.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{cat.title}</span>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
                      {cat.guides.length}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
