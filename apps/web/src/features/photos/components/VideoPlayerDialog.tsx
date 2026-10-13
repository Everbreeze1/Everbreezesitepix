import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { X } from "lucide-react";

interface VideoPlayerDialogProps {
  open: boolean;
  onClose: () => void;
  videoUrl: string | null;
  title?: string;
  mimeType?: string | null;
  emptyMessage?: string;
}

/**
 * Full-screen video viewer.
 *
 * The footage is shown at its own shape, centred on a dark backdrop, and is
 * never enlarged past the size it was recorded at. It used to be stretched to
 * fill the whole window, which on a desktop screen blew a phone clip up until
 * it looked zoomed in and soft. The title and the close button sit in their own
 * bar above the video instead of over it, so they never cover the picture or
 * the player's controls.
 */
export function VideoPlayerDialog({
  open,
  onClose,
  videoUrl,
  title,
  mimeType,
  emptyMessage,
}: VideoPlayerDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black/95 p-0 text-white [&>button]:hidden">
        <DialogTitle className="sr-only">{title ?? "Video preview"}</DialogTitle>
        <div className="flex h-14 shrink-0 items-center gap-3 px-3">
          <button
            type="button"
            aria-label="Close video"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {title ? (
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{title}</p>
          ) : null}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-3 pb-4 sm:px-8 sm:pb-8">
          {videoUrl ? (
            <video
              key={videoUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              // max-* with auto width and height keeps the video's own shape and
              // only ever shrinks it to fit, never stretches it to fill.
              className="block h-auto max-h-[calc(100dvh-6rem)] w-auto max-w-full rounded-lg bg-black object-contain"
            >
              {mimeType ? <source src={videoUrl} type={mimeType} /> : null}
              <source src={videoUrl} />
              Your browser cannot play this video.
            </video>
          ) : (
            <div className="max-w-sm px-6 text-center text-sm text-white/70">
              {emptyMessage ?? "Loading video…"}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
