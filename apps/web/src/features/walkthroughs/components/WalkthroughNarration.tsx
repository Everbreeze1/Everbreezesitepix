import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  ImageOff,
  Info,
  ListVideo,
  Pause,
  Play,
  Quote,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanCaption } from "@sitepix/shared";
import { cn } from "@/lib/utils";
import type { WalkthroughPhotoStep } from "@/components/WalkthroughReport";

/**
 * The premium Summary: a walkthrough recording with an AI narration track laid
 * over its timeline, and every captured photo carrying its own AI narration.
 *
 * The client's words: "it should produce a short AI-narrated video from the
 * walkthrough recording, plus a list of the captured photos each with
 * AI-generated narration describing what was done in that shot and/or
 * summarizing what was said on camera near that moment", and it "needs to feel
 * premium: polished playback UI, a clear 'AI-narrated' treatment", not "a
 * generic photo-caption card that looks the same whether or not anyone spoke
 * during the recording".
 *
 * Three things carry that here.
 *
 * **The narration is on the timeline, not beside it.** Chapters have real
 * second offsets. The rail highlights the one playing, scrolls itself to it,
 * and seeks the video when you click one. The photo strip under the player sits
 * at each shot's offset, so the picture and the moment it was taken are the
 * same control.
 *
 * **Narration can be heard, not only read.** `speechSynthesis` reads the active
 * chapter aloud and ducks the original audio while it does, which is what makes
 * this an AI-narrated *video* rather than a video with a sidebar. It is opt-in,
 * off by default, and the toggle hides itself entirely where the browser has no
 * speech engine rather than offering a control that does nothing.
 *
 * **A silent walk looks different from a narrated one.** Every photo shows what
 * the AI says was going on. Only a photo with real speech behind it also shows
 * the quote, and a recording nobody spoke on says so once, at the top, instead
 * of repeating an apology under each tile.
 */

export interface NarrationChapter {
  start: number;
  end: number;
  title: string;
  narration: string;
}

export interface NarrationPhoto {
  photoId: string;
  offsetSeconds: number;
  narration: string;
  spoken: string | null;
}

export interface WalkthroughNarration {
  version: number;
  hasSpeech: boolean;
  headline: string;
  chapters: NarrationChapter[];
  photos: NarrationPhoto[];
  aiGenerated: boolean;
}

const fmtOffset = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;

/** Does this browser have a speech engine we can narrate through? */
function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

/** The small purple mark that says "a model wrote this". Used in three places. */
export function AiNarratedChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-primary",
        className,
      )}
    >
      <Sparkles className="h-3 w-3" strokeWidth={2.25} />
      AI narrated
    </span>
  );
}

/**
 * The player and its narration rail.
 *
 * Owns playback state rather than reading it off the `<video>` on every render:
 * `timeupdate` fires roughly four times a second, and the rail, the strip and
 * the speech trigger all need the same value at the same moment.
 */
export function WalkthroughNarratedPlayer({
  videoUrl,
  mimeType,
  durationSeconds,
  narration,
  steps,
  className,
  controllerRef,
}: {
  videoUrl: string;
  mimeType: string | null;
  /** The recorded length, used to place markers before metadata has loaded. */
  durationSeconds: number;
  narration: WalkthroughNarration;
  /** The captured photos, for the strip under the player. */
  steps: WalkthroughPhotoStep[];
  className?: string;
  /**
   * Filled in with a `seek` the page can call, so the photo list further down
   * can drive this player. An imperative handle rather than lifted state
   * because seeking is an event, not a value: mirroring `currentTime` into the
   * page would re-render the whole walkthrough four times a second.
   */
  controllerRef?: React.MutableRefObject<{ seek: (seconds: number) => void } | null>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const railRef = useRef<HTMLOListElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [narrating, setNarrating] = useState(false);
  const [canNarrate] = useState(speechAvailable);
  /** The chapter last spoken, so a chapter is never read out twice running. */
  const spokenChapterRef = useRef<number>(-1);

  const chapters = narration.chapters ?? [];
  const activeChapter = useMemo(() => {
    if (!chapters.length) return -1;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].start) return i;
    }
    return 0;
  }, [chapters, currentTime]);

  const seek = useCallback((seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    setCurrentTime(Math.max(0, seconds));
    void el.play().catch(() => {
      /* Autoplay refused after a seek is fine - the user still moved. */
    });
  }, []);

  useEffect(() => {
    if (!controllerRef) return;
    controllerRef.current = { seek };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef, seek]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }, []);

  /*
   * Speak the chapter that just became active.
   *
   * Keyed on the chapter index rather than on the clock so a chapter is read
   * once however long it runs, and re-armed on seek because jumping back to a
   * chapter is a deliberate request to hear it again. The original audio is
   * ducked rather than muted outright: the site noise underneath is part of
   * what the technician recorded.
   */
  useEffect(() => {
    if (!narrating || !canNarrate) return;
    if (activeChapter < 0 || activeChapter === spokenChapterRef.current) return;
    const chapter = chapters[activeChapter];
    if (!chapter?.narration) return;
    spokenChapterRef.current = activeChapter;

    const utterance = new SpeechSynthesisUtterance(chapter.narration);
    utterance.rate = 1;
    utterance.pitch = 1;
    const el = videoRef.current;
    const restore = el?.volume ?? 1;
    if (el) el.volume = 0.15;
    utterance.onend = () => {
      if (videoRef.current) videoRef.current.volume = restore;
    };
    utterance.onerror = utterance.onend;
    window.speechSynthesis.speak(utterance);
  }, [activeChapter, chapters, narrating, canNarrate]);

  // Never leave a voice talking over a page the user has left.
  useEffect(() => {
    return () => {
      if (speechAvailable()) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (narrating) return;
    if (speechAvailable()) window.speechSynthesis.cancel();
    if (videoRef.current) videoRef.current.volume = 1;
    spokenChapterRef.current = -1;
  }, [narrating]);

  /* Keep the active chapter in view without yanking the whole page with it. */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || activeChapter < 0) return;
    const item = rail.children[activeChapter] as HTMLElement | undefined;
    if (!item) return;
    const top = item.offsetTop - rail.clientHeight / 2 + item.clientHeight / 2;
    rail.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeChapter]);

  const total = duration || durationSeconds || 0;
  const progress = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-gradient-to-r from-primary/[0.09] via-primary/[0.04] to-transparent px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <AudioLines className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold">
              AI Summary
              <AiNarratedChip />
            </p>
            {narration.headline && (
              <p className="truncate text-[11.5px] text-muted-foreground">{narration.headline}</p>
            )}
          </div>
        </div>
        {canNarrate && chapters.length > 0 && (
          <Button
            size="sm"
            variant={narrating ? "default" : "outline"}
            onClick={() => setNarrating((v) => !v)}
            className="h-8 rounded-lg text-xs font-bold"
          >
            {narrating ? (
              <VolumeX className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Volume2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {narrating ? "Stop narration" : "Play AI narration"}
          </Button>
        )}
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="relative bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            className="aspect-video h-auto w-full bg-black"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDuration(d);
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeked={() => {
              spokenChapterRef.current = -1;
            }}
          >
            {mimeType && <source src={videoUrl} type={mimeType} />}
          </video>

          {/*
            The chapter now playing, over the footage. This is the single
            clearest signal that the video is narrated: the line moves as the
            walk moves, whether or not the voice is switched on.
          */}
          {activeChapter >= 0 && chapters[activeChapter]?.narration && (
            <div className="pointer-events-none absolute inset-x-0 bottom-12 px-4">
              <p className="mx-auto max-w-2xl rounded-xl bg-black/65 px-3.5 py-2 text-center text-[13px] leading-snug text-white backdrop-blur-sm">
                {chapters[activeChapter].narration}
              </p>
            </div>
          )}
        </div>

        <div className="flex min-h-[220px] flex-col border-t border-border/60 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <ListVideo className="h-3.5 w-3.5" />
              Narration
            </p>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {fmtOffset(currentTime)} / {fmtOffset(total)}
            </span>
          </div>

          {chapters.length ? (
            <ol ref={railRef} className="max-h-[300px] flex-1 overflow-y-auto px-2 py-2">
              {chapters.map((chapter, i) => (
                <li key={`${chapter.start}-${i}`}>
                  <button
                    type="button"
                    onClick={() => seek(chapter.start)}
                    aria-current={i === activeChapter}
                    className={cn(
                      "w-full rounded-xl px-2.5 py-2 text-left transition-colors",
                      i === activeChapter
                        ? "bg-primary/10 ring-1 ring-inset ring-primary/25"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-mono text-[11px] tabular-nums",
                          i === activeChapter ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {fmtOffset(chapter.start)}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[12.5px] font-bold",
                          i === activeChapter ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {chapter.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
                      {chapter.narration}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="flex-1 px-3.5 py-6 text-center text-xs text-muted-foreground">
              No narration chapters for this recording.
            </p>
          )}

          <div className="border-t border-border/60 px-3.5 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={togglePlay}
              className="h-8 w-full justify-start rounded-lg text-xs font-bold"
            >
              {playing ? (
                <Pause className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {playing ? "Pause" : "Play walkthrough"}
            </Button>
          </div>
        </div>
      </div>

      {/*
        Photo markers on the recording's own timeline. The bar is a read-only
        picture of where you are; the thumbnails are the controls, because a
        two-pixel dot is not a tap target on a phone.
      */}
      {steps.length > 0 && total > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="relative h-1.5 w-full overflow-visible rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary/70 transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
            {steps.map((step, i) => (
              <span
                key={`${step.photo_id}-${i}`}
                aria-hidden
                className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground/60"
                style={{ left: `${Math.min(100, (step.offset_seconds / total) * 100)}%` }}
              />
            ))}
          </div>
          <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {steps.map((step, i) => (
              <li key={`${step.photo_id}-strip-${i}`} className="shrink-0">
                <button
                  type="button"
                  onClick={() => seek(step.offset_seconds)}
                  title={`Jump to ${fmtOffset(step.offset_seconds)}`}
                  className="group relative block h-14 w-20 overflow-hidden rounded-lg border border-border bg-muted transition hover:border-primary/50"
                >
                  {step.image_url ? (
                    <img
                      src={step.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition group-hover:scale-[1.04]"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-4 w-4" />
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-center font-mono text-[10px] text-white">
                    {fmtOffset(step.offset_seconds)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/**
 * The captured photos, each with its AI narration.
 *
 * `onSeek` is optional: with a video on the page a tile is a seek control, and
 * on the public share page (no player) it is not. Passing it is what turns the
 * offset badge into a button, so the two renderings differ by capability rather
 * than by a separate component.
 */
export function AiNarratedPhotoSteps({
  steps,
  narration,
  onSeek,
}: {
  steps: WalkthroughPhotoStep[];
  narration: WalkthroughNarration;
  onSeek?: (seconds: number) => void;
}) {
  const byId = useMemo(
    () => new Map((narration.photos ?? []).map((p) => [p.photoId, p])),
    [narration.photos],
  );
  if (!steps.length) return null;

  const spokenCount = steps.filter((s) => byId.get(s.photo_id)?.spoken).length;

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            Photos in this walkthrough
            <AiNarratedChip />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {narration.hasSpeech
              ? "What was done in each shot, with what was said on camera near that moment."
              : "Nobody spoke during this recording, so each photo is described from what was captured with it."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {steps.length} {steps.length === 1 ? "photo" : "photos"}
          {narration.hasSpeech ? ` · ${spokenCount} narrated on camera` : ""}
        </span>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map((step, idx) => {
          const ai = byId.get(step.photo_id);
          const caption = cleanCaption(step.caption);
          /*
           * Fall back to the note the older pipeline estimated when this photo
           * predates narration. Better a real sentence from the transcript than
           * an empty card while the walkthrough waits to be regenerated.
           */
          const narrationText = ai?.narration || step.spoken_note?.trim() || caption || "";
          const spoken = ai ? ai.spoken : (step.spoken_note?.trim() ?? null);

          return (
            <li
              key={`${step.photo_id}-${idx}`}
              className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {step.image_url ? (
                  <img
                    src={step.image_url}
                    alt={narrationText || "Walkthrough photo"}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
                {onSeek ? (
                  <button
                    type="button"
                    onClick={() => onSeek(step.offset_seconds)}
                    className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/85"
                  >
                    <Play className="h-2.5 w-2.5" />
                    {fmtOffset(step.offset_seconds)}
                  </button>
                ) : (
                  <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
                    {fmtOffset(step.offset_seconds)}
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                <div>
                  <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
                    <Sparkles className="h-3 w-3" strokeWidth={2.25} />
                    AI narration
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-foreground">
                    {narrationText || (
                      <span className="text-muted-foreground">
                        Nothing was recorded against this photo.
                      </span>
                    )}
                  </p>
                </div>

                {/*
                  The half that only exists when somebody actually spoke. This
                  is the difference the client asked for: a silent walkthrough's
                  card is visibly shorter than a narrated one's, rather than
                  both rendering the same strip with different text in it.
                */}
                {spoken ? (
                  <figure className="rounded-xl border-l-2 border-amber-400 bg-amber-50/70 px-3 py-2 dark:bg-amber-950/25">
                    <figcaption className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      <Quote className="h-3 w-3" strokeWidth={2.25} />
                      Heard on camera
                    </figcaption>
                    <blockquote className="mt-1 text-[13px] italic leading-relaxed text-foreground">
                      &ldquo;{spoken}&rdquo;
                    </blockquote>
                  </figure>
                ) : narration.hasSpeech ? (
                  <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Info className="h-3 w-3 shrink-0" />
                    Nothing was said near this moment.
                  </p>
                ) : null}

                {/* The technician's own caption, kept distinct from both. */}
                {caption && caption !== narrationText && (
                  <p className="mt-auto border-t border-border/60 pt-2 text-[11.5px] text-muted-foreground">
                    Caption: {caption}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
