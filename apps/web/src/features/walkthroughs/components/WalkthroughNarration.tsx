import { useMemo } from "react";
import { ImageOff, Play, Sparkles } from "lucide-react";
import { cleanCaption } from "@everlumen/shared";
import { cn } from "@/lib/utils";
import type { WalkthroughPhotoStep } from "@/components/WalkthroughReport";

/**
 * The AI's narration payload for a recording, and the photo list the public
 * walkthrough link renders from it.
 *
 * The narration exists to write reports. It is not read out loud or laid over
 * the video any more: "we don't need no out loud AI narration. That is only
 * used to produce automatic reports."
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
  /**
   * False when the model was unavailable and this came from the deterministic
   * builder instead.
   *
   * Both produce the same shape, which is the point - the feature still works
   * when Gemini is rate-limited. But the shapes are not the same claim, and
   * this is what the UI checks before badging anything "AI narrated". Selling
   * a premium AI artefact and then stamping the badge on a timestamp-and-caption
   * stub is the one failure a user would be right to call dishonest.
   */
  aiGenerated: boolean;
}

const fmtOffset = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;

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
  /** See WalkthroughNarration.aiGenerated - the badge is a claim, not decoration. */
  const aiWritten = narration.aiGenerated !== false;
  if (!steps.length) return null;

  return (
    <section className="mb-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            Photos in this walkthrough
            {aiWritten && <AiNarratedChip />}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {!aiWritten
              ? "Written from the timestamps and what was recorded with each photo. Regenerate the summary to have AI narrate them."
              : "What was being done in each shot."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {steps.length} {steps.length === 1 ? "photo" : "photos"}
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
                  <p
                    className={cn(
                      "flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide",
                      aiWritten ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {aiWritten && <Sparkles className="h-3 w-3" strokeWidth={2.25} />}
                    {aiWritten ? "AI narration" : "From this shot"}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-foreground">
                    {narrationText || (
                      <span className="text-muted-foreground">
                        Nothing was recorded against this photo.
                      </span>
                    )}
                  </p>
                </div>

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
