import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MapPin,
  Calendar,
  Building2,
  Tag as TagIcon,
  StickyNote,
  CheckSquare,
  MessageSquare,
  Mic,
  MicOff,
  Loader2,
  Pencil,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface Props {
  project: {
    name: string;
    address?: string | null;
    createdAt?: string | null;
  };
  photo: {
    id: string;
    takenAt?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  description: string | null;
  onSaveDescription: (next: string | null) => Promise<void>;
  tagsSlot: ReactNode;
  tasksSlot: ReactNode;
  commentsSlot: ReactNode;
}

type PanelTab = "details" | "tasks" | "comments";
type CountedTab = "tasks" | "comments";

/* ------------------------------------------------------------------ context */

/*
 * The tasks and comments panels are handed in as slots by the page that opened
 * the lightbox, so this component cannot ask them how many rows they hold and
 * the page does not know either - the panels load their own data. Context
 * carries the two facts across the slot boundary instead: how many rows each
 * one has (for the tab count) and which tab is on screen (so the comment list
 * can scroll to the newest message when it is revealed, not while it is
 * display:none and has no scroll height).
 *
 * Both hooks degrade to "no panel around me" so the panels stay usable on
 * their own.
 */
interface PanelContextValue {
  reportCount: (tab: CountedTab, count: number) => void;
  activeTab: PanelTab;
}

const PhotoPanelContext = createContext<PanelContextValue | null>(null);

/** Publish how many rows this slot holds, for the tab strip's count. */
export function useReportPanelCount(tab: CountedTab, count: number) {
  const report = useContext(PhotoPanelContext)?.reportCount;
  useEffect(() => {
    report?.(tab, count);
  }, [report, tab, count]);
}

/** Whether this slot is the tab currently on screen. */
export function usePanelIsActive(tab: PanelTab): boolean {
  const ctx = useContext(PhotoPanelContext);
  return ctx ? ctx.activeTab === tab : true;
}

/* ------------------------------------------------------------------- pieces */

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Cross-browser SpeechRecognition access. */
function getSpeechRecognition(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

function SectionHeader({
  icon: Icon,
  label,
  action,
}: {
  icon: any;
  label: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/55">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {action}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-sidebar-border bg-sidebar-accent p-4">
      {children}
    </section>
  );
}

/*
 * Deliberately plain toggle buttons rather than role="tablist"/role="tab", the
 * same call ProjectChecklists makes for its filter strip: half-implemented tab
 * semantics promise a screen reader arrow-key navigation and an owned tabpanel
 * that are not wired up here.
 */
function TabButton({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: any;
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`font-manrope relative flex min-h-11 flex-1 items-center justify-center gap-1.5 px-2 py-2 text-[13px] font-bold transition-colors ${
        active
          ? "text-sidebar-foreground"
          : "text-sidebar-foreground/55 hover:text-sidebar-foreground/85"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
      {count !== null && count > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
            active
              ? "bg-sidebar-foreground/15 text-sidebar-foreground"
              : "bg-sidebar-foreground/10 text-sidebar-foreground/60"
          }`}
        >
          {count}
        </span>
      )}
      {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary" />}
    </button>
  );
}

/* -------------------------------------------------------------------- panel */

export function PhotoDetailsPanel({
  project,
  photo,
  description,
  onSaveDescription,
  tagsSlot,
  tasksSlot,
  commentsSlot,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? "");
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");

  /*
   * The tab survives moving to the next photo on purpose: flipping through a
   * job's photos reading the conversation on each is the reason this panel
   * exists, and resetting to Details every time would undo that choice once per
   * arrow key.
   */
  const [tab, setTab] = useState<PanelTab>("details");
  const [counts, setCounts] = useState<Record<CountedTab, number | null>>({
    tasks: null,
    comments: null,
  });

  const reportCount = useCallback((which: CountedTab, count: number) => {
    setCounts((prev) => (prev[which] === count ? prev : { ...prev, [which]: count }));
  }, []);
  const ctx = useMemo<PanelContextValue>(
    () => ({ reportCount, activeTab: tab }),
    [reportCount, tab],
  );

  useEffect(() => {
    setEditing(false);
    setDraft(description ?? "");
    stopListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id]);

  const takenLabel = formatDate(photo.takenAt);
  const hasLocation = photo.latitude != null && photo.longitude != null;
  const mapsQuery = hasLocation
    ? `${photo.latitude},${photo.longitude}`
    : project.address
      ? encodeURIComponent(project.address)
      : null;
  const mapsUrl = mapsQuery ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}` : null;

  function stopListening() {
    try {
      recRef.current?.stop?.();
    } catch {
      /* noop */
    }
    recRef.current = null;
    setListening(false);
  }

  function toggleVoice() {
    if (listening) {
      stopListening();
      return;
    }
    const SR = getSpeechRecognition();
    if (!SR) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    baseTextRef.current = draft ? draft.replace(/\s+$/, "") + " " : "";
    rec.onresult = (e: any) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (finalText) baseTextRef.current += finalText;
      setDraft((baseTextRef.current + interim).replace(/\s+/g, " ").trimStart());
    };
    rec.onerror = (e: any) => {
      toast.error(`Voice: ${e?.error ?? "error"}`);
      stopListening();
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
      if (!editing) setEditing(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to start voice input");
    }
  }

  async function save() {
    setSaving(true);
    try {
      const next = draft.trim() || null;
      await onSaveDescription(next);
      setEditing(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save description");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PhotoPanelContext.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
        {/* Project header */}
        <header className="shrink-0 border-b border-sidebar-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/20 ring-1 ring-sidebar-border">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] font-semibold text-sidebar-foreground">
                {project.name}
              </h3>
              {project.address && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-sidebar-foreground/60">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{project.address}</span>
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-sidebar-foreground/45">
                {takenLabel && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {takenLabel}
                  </span>
                )}
                {hasLocation && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-emerald-400" />
                    GPS
                  </span>
                )}
              </div>
            </div>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={
                  hasLocation
                    ? "Open photo location in Google Maps"
                    : "Open project address in Google Maps"
                }
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent text-sidebar-foreground transition hover:bg-sidebar-foreground/15"
              >
                <ExternalLink className="h-4 w-4" />
                <span className="sr-only">Open in Google Maps</span>
              </a>
            )}
          </div>
        </header>

        {/*
         * Tabs, not one long scroll. Stacked, the composer for the comment you
         * came here to write sat below the tags, the description and every task
         * on the photo, and both lists had their own scrollbar inside the
         * panel's scrollbar. A tab gets the full height of the panel, so each
         * list scrolls once and the things you act with - the task field, the
         * message box - hold still at a known edge.
         */}
        <nav className="flex shrink-0 items-stretch gap-1 border-b border-sidebar-border px-2">
          <TabButton
            icon={StickyNote}
            label="Details"
            count={null}
            active={tab === "details"}
            onClick={() => setTab("details")}
          />
          <TabButton
            icon={CheckSquare}
            label="Tasks"
            count={counts.tasks}
            active={tab === "tasks"}
            onClick={() => setTab("tasks")}
          />
          <TabButton
            icon={MessageSquare}
            label="Comments"
            count={counts.comments}
            active={tab === "comments"}
            onClick={() => setTab("comments")}
          />
        </nav>

        {/*
         * All three stay mounted and are hidden with display:none rather than
         * unmounted: the comment panel holds a realtime subscription and both
         * panels report the counts the tab strip above is showing, neither of
         * which survives being torn down every time somebody looks at the tags.
         */}
        <div className="min-h-0 flex-1">
          <div
            className={`h-full space-y-3 overflow-y-auto px-4 py-4 ${tab === "details" ? "block" : "hidden"}`}
          >
            <Section>
              <SectionHeader icon={TagIcon} label="Tags" />
              <div className="text-sm text-sidebar-foreground/90">{tagsSlot}</div>
            </Section>

            <Section>
              <SectionHeader
                icon={StickyNote}
                label="Description"
                action={
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={toggleVoice}
                      title={listening ? "Stop voice input" : "Dictate description"}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                        listening
                          ? "border-rose-400/60 bg-rose-500/20 text-rose-200 shadow-[0_0_0_3px_rgba(244,63,94,0.15)]"
                          : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground/70 hover:bg-sidebar-foreground/15 hover:text-sidebar-foreground"
                      }`}
                    >
                      {listening ? (
                        <MicOff className="h-3.5 w-3.5" />
                      ) : (
                        <Mic className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {!editing && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(description ?? "");
                          setEditing(true);
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-sidebar-border bg-sidebar-accent px-2 text-[11px] font-medium text-sidebar-foreground/70 transition hover:bg-sidebar-foreground/15 hover:text-sidebar-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                        {description ? "Edit" : "Add"}
                      </button>
                    )}
                  </div>
                }
              />
              {editing ? (
                <div className="space-y-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Describe what's in this photo - location, issue, next steps…"
                    rows={4}
                    className="resize-none border-sidebar-border bg-sidebar/60 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus-visible:ring-sidebar-ring"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40">
                      {listening ? "Listening…" : "Tip: tap the mic to dictate"}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        onClick={() => {
                          setEditing(false);
                          setDraft(description ?? "");
                          stopListening();
                        }}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8"
                        onClick={save}
                        disabled={saving || draft.trim() === (description ?? "").trim()}
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : description ? (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-sidebar-foreground/85">
                  {description}
                </p>
              ) : (
                <p className="rounded-lg border border-dashed border-sidebar-border px-3 py-4 text-center text-xs italic text-sidebar-foreground/40">
                  No description yet.
                </p>
              )}
            </Section>
          </div>

          <div className={`h-full min-h-0 px-4 py-4 ${tab === "tasks" ? "flex" : "hidden"}`}>
            <div className="min-h-0 w-full">{tasksSlot}</div>
          </div>

          <div className={`h-full min-h-0 px-4 py-4 ${tab === "comments" ? "flex" : "hidden"}`}>
            <div className="min-h-0 w-full">{commentsSlot}</div>
          </div>
        </div>
      </div>
    </PhotoPanelContext.Provider>
  );
}
