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
 * Modal video preview. On mobile the dialog goes near-fullscreen so the
 * player is large and the native controls don't fight with the dialog's
 * own close button — we hide the default close and add our own top-left
 * pill that stays clear of the volume/fullscreen icons on the right.
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
      <DialogContent className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-black p-0 text-white [&>button]:hidden">
        <DialogTitle className="sr-only">{title ?? "Video preview"}</DialogTitle>
        <div className="relative flex h-full w-full items-center justify-center bg-black">
          {videoUrl ? (
            <video
              key={videoUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
            >
              {mimeType ? <source src={videoUrl} type={mimeType} /> : null}
              <source src={videoUrl} />
              Your browser cannot play this video.
            </video>
          ) : (
            <div className="flex h-full max-w-sm items-center justify-center px-6 text-center text-sm text-white/70">
              {emptyMessage ?? "Loading video…"}
            </div>
          )}

          {/* Custom close — top-left so it never overlaps the player's
              volume/fullscreen controls on the right. */}
          <button
            type="button"
            aria-label="Close video"
            onClick={onClose}
            className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75"
          >
            <X className="h-5 w-5" />
          </button>

          {title ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-16 pb-6 pt-3 text-sm font-medium text-white/90 line-clamp-1">
              {title}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
