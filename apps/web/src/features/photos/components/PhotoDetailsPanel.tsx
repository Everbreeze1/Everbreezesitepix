import { useEffect, useRef, useState, type ReactNode } from "react";
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
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {action}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      {children}
    </section>
  );
}

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
    <div className="flex h-full min-h-0 flex-col bg-gradient-to-b from-neutral-950 via-neutral-950 to-black">
      {/* Sticky project header */}
      <header className="sticky top-0 z-10 shrink-0 border-b border-white/10 bg-black/50 px-5 py-4 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 ring-1 ring-white/10">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold text-white">{project.name}</h3>
            {project.address && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-white/60">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{project.address}</span>
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:bg-white/15"
            >
              <ExternalLink className="h-4 w-4" />
              <span className="sr-only">Open in Google Maps</span>
            </a>
          )}
        </div>
      </header>

      {/* Scrollable sections */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {/* Tags */}
        <Section>
          <SectionHeader icon={TagIcon} label="Tags" />
          <div className="text-sm text-white/90">{tagsSlot}</div>
        </Section>

        {/* Description */}
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
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                </button>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(description ?? "");
                      setEditing(true);
                    }}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-white/70 transition hover:bg-white/15 hover:text-white"
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
                className="resize-none border-white/15 bg-black/30 text-sm text-white placeholder:text-white/40 focus-visible:ring-white/25"
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-white/40">
                  {listening ? "Listening…" : "Tip: tap the mic to dictate"}
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-white/70 hover:bg-white/10 hover:text-white"
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
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-white/85">
              {description}
            </p>
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs italic text-white/40">
              No description yet.
            </p>
          )}
        </Section>

        {/* Tasks */}
        <Section>
          <SectionHeader icon={CheckSquare} label="Tasks" />
          <div className="min-h-[80px]">{tasksSlot}</div>
        </Section>

        {/* Comments */}
        <Section>
          <SectionHeader
            icon={MessageSquare}
            label="Comments"
            action={
              <span className="text-[10px] font-medium normal-case tracking-normal text-white/40">
                @ to mention
              </span>
            }
          />
          <div className="min-h-[120px]">{commentsSlot}</div>
        </Section>
      </div>
    </div>
  );
}
