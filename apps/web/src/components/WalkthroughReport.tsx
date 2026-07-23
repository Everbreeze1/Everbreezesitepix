import ReactMarkdown from "react-markdown";
import { Check, ImageOff, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanCaption } from "@sitepix/shared";

export interface WalkthroughPhotoStep {
  photo_id: string;
  offset_seconds: number;
  spoken_note: string | null;
  position: number;
  caption: string | null;
  taken_at: string | null;
  image_url: string;
}

const formatOffset = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.max(0, seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export function cleanWalkthroughMarkdown(markdown: string) {
  return (
    markdown
      .replace(/\n## (?:Additional Photos|Photos)\n[\s\S]*$/i, "")
      .replace(/!\[[^\]]*\]\(photo:[^)\s]+\)/g, "")
      // The page renders the walkthrough title in its own header card, so drop
      // the leading H1 the AI emits to avoid a duplicated title in the body.
      .replace(/^\s*#\s+.+\n+/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function estimateWalkthroughNote(
  transcript: string | null | undefined,
  startSeconds: number,
  endSeconds: number | null,
  durationSeconds: number,
  index: number = 0,
  total: number = 1,
) {
  const words = (transcript ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const totalCount = Math.max(1, total);
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : endSeconds && endSeconds > startSeconds
        ? endSeconds
        : 0;

  let startRatio: number;
  let endRatio: number;
  if (duration > 0 && Number.isFinite(startSeconds)) {
    const perPhoto = duration / totalCount;
    const windowStart = Math.max(0, startSeconds - Math.min(8, perPhoto / 2));
    const windowEnd = Math.min(
      duration,
      endSeconds && endSeconds > startSeconds ? endSeconds : startSeconds + Math.max(10, perPhoto),
    );
    startRatio = Math.min(0.95, Math.max(0, windowStart / duration));
    endRatio = Math.min(1, Math.max(startRatio + 0.02, windowEnd / duration));
  } else {
    const share = 1 / totalCount;
    startRatio = Math.min(0.95, index * share);
    endRatio = Math.min(1, (index + 1) * share);
  }
  const start = Math.min(words.length - 1, Math.floor(words.length * startRatio));
  const end = Math.min(words.length, Math.max(start + 6, Math.ceil(words.length * endRatio)));
  return words.slice(start, end).join(" ").trim() || null;
}

export function WalkthroughPhotoSteps({ steps }: { steps: WalkthroughPhotoStep[] }) {
  if (!steps.length) return null;

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Photo walkthrough</h2>
          <p className="text-xs text-muted-foreground">
            Narration mapped to the moment each photo was taken.
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {steps.length} {steps.length === 1 ? "photo" : "photos"}
        </span>
      </div>
      <ol className="space-y-4">
        {steps.map((step, idx) => {
          const note = step.spoken_note?.trim();
          return (
            <li
              key={`${step.photo_id}-${idx}`}
              className="grid gap-4 overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm sm:grid-cols-[minmax(220px,0.9fr)_minmax(0,1fr)] sm:p-4"
            >
              <div className="overflow-hidden rounded-lg border border-border bg-muted">
                {step.image_url ? (
                  <img
                    src={step.image_url}
                    alt={`Walkthrough photo ${idx + 1}`}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 480px"
                    className="aspect-[4/3] h-full w-full bg-muted object-cover"
                  />
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col justify-between gap-3 py-1">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 font-semibold text-primary-foreground">
                      Photo {idx + 1}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {formatOffset(step.offset_seconds)}
                    </span>
                    {step.taken_at ? (
                      <span className="text-muted-foreground">
                        {new Date(step.taken_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </div>
                  {note ? (
                    <blockquote className="mt-3 border-l-2 border-primary/40 pl-3 text-sm italic leading-relaxed text-foreground">
                      &ldquo;{note}&rdquo;
                    </blockquote>
                  ) : (
                    <p className="mt-3 text-sm italic leading-relaxed text-muted-foreground">
                      No narration captured near this photo.
                    </p>
                  )}
                </div>
                {(() => {
                  const c = cleanCaption(step.caption);
                  return c ? <p className="truncate text-xs text-muted-foreground">{c}</p> : null;
                })()}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function WalkthroughMarkdown({
  markdown,
  photoUrls,
}: {
  markdown: string;
  photoUrls: Record<string, string>;
}) {
  const trimmed = (markdown ?? "").trim();
  if (!trimmed) return null;
  return (
    <section className="mt-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
          <p className="text-xs text-muted-foreground">
            Organized notes from the walkthrough narration.
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-muted/20 p-5 prose prose-sm max-w-none dark:prose-invert prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-h2:text-base prose-h2:uppercase prose-h2:tracking-wide prose-h2:text-muted-foreground prose-h3:text-sm prose-h3:font-semibold prose-h3:text-foreground prose-p:leading-relaxed prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-img:rounded-lg prose-img:border prose-img:border-border">
        <ReactMarkdown
          components={{
            img: ({ src, alt }) => {
              const s = typeof src === "string" ? src : "";
              if (s.startsWith("photo:")) {
                const id = s.slice("photo:".length);
                const url = photoUrls[id];
                if (!url)
                  return (
                    <span className="my-3 flex h-32 items-center justify-center rounded border border-dashed border-border bg-muted text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </span>
                  );
                return (
                  <img
                    src={url}
                    alt={alt ?? ""}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 100vw, 720px"
                    className="h-auto w-full max-w-full rounded-lg border border-border bg-muted"
                  />
                );
              }
              return (
                <img
                  src={s}
                  alt={alt ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full max-w-full"
                />
              );
            },
            input: ({ type, checked, ...props }) =>
              type === "checkbox" ? (
                <input
                  type="checkbox"
                  defaultChecked={!!checked}
                  className="mr-2 align-middle"
                  {...props}
                />
              ) : (
                <input type={type} {...props} />
              ),
          }}
        >
          {trimmed}
        </ReactMarkdown>
      </div>
    </section>
  );
}

export function WalkthroughShareButtons({
  url,
  title,
  copied,
  onCopy,
}: {
  url: string;
  title: string;
  copied: boolean;
  onCopy: () => Promise<void> | void;
}) {
  if (!url) return null;

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({ title, text: title, url });
        return;
      } catch {
        // fall through to copy
      }
    }
    await onCopy();
  };

  return (
    <Button type="button" size="sm" onClick={handleShare}>
      {copied ? (
        <Check className="mr-1.5 h-3.5 w-3.5" />
      ) : (
        <Share2 className="mr-1.5 h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Share"}
    </Button>
  );
}
