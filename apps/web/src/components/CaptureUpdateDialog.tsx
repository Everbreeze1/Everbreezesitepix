import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Camera, Upload, Video, X } from "lucide-react";
import { DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface CaptureUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Array<{ id: string; name: string }>;
}

type CaptureMode = "photo" | "walkthrough";

export function CaptureUpdateDialog({ open, onOpenChange, projects }: CaptureUpdateDialogProps) {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string>("");
  const [mode, setMode] = useState<CaptureMode>("photo");

  useEffect(() => {
    if (open) {
      setProjectId("");
      setMode("photo");
    }
  }, [open]);

  const handleSubmit = () => {
    if (!projectId) return;
    onOpenChange(false);
    navigate({
      to: "/projects/$projectId",
      params: { projectId },
      search: mode === "photo" ? { camera: 1 } : { walkthrough: 1 },
    } as any);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full max-w-[448px] -translate-x-1/2 -translate-y-1/2",
            "rounded-[28px] border border-border bg-background p-6 shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                Everlumen workflow
              </p>
              <DialogPrimitive.Title className="pt-1 text-xl font-extrabold text-foreground">
                Capture an update
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring cursor-pointer">
              <X className="h-4 w-4" strokeWidth={1.75} />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="pt-5 text-sm text-muted-foreground">
            Choose where this field update belongs.
          </DialogPrimitive.Description>

          {/* Project picker */}
          <div className="pt-4">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-12 w-full rounded-2xl border border-border bg-card px-4 text-sm font-medium text-foreground shadow-[0_5px_12px_-12px_rgba(16,25,41,0.35)] focus:ring-0 focus:ring-offset-0">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Photo / Walkthrough toggle */}
          <div className="grid grid-cols-2 gap-3 pt-5">
            <button
              type="button"
              onClick={() => setMode("photo")}
              className={cn(
                "flex flex-col items-start gap-3 rounded-xl border p-4 text-left outline-none transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
                mode === "photo" ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <Camera
                className={cn(
                  "h-5 w-5",
                  mode === "photo" ? "text-primary" : "text-muted-foreground",
                )}
                strokeWidth={1.75}
              />
              <span
                className={cn(
                  "text-sm font-bold",
                  mode === "photo" ? "text-primary" : "text-muted-foreground",
                )}
              >
                Photo
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("walkthrough")}
              className={cn(
                "flex flex-col items-start gap-3 rounded-xl border p-4 text-left outline-none transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring",
                mode === "walkthrough"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent",
              )}
            >
              <Video
                className={cn(
                  "h-5 w-5",
                  mode === "walkthrough" ? "text-primary" : "text-muted-foreground",
                )}
                strokeWidth={1.75}
              />
              <span
                className={cn(
                  "text-sm font-bold",
                  mode === "walkthrough" ? "text-primary" : "text-muted-foreground",
                )}
              >
                Walkthrough
              </span>
            </button>
          </div>

          {/* Submit */}
          <button
            type="button"
            disabled={!projectId}
            onClick={handleSubmit}
            className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-primary-foreground outline-none transition-opacity cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mode === "photo" ? (
              <>
                <Upload className="h-4 w-4" strokeWidth={1.75} />
                Add photo
              </>
            ) : (
              <>
                <Video className="h-4 w-4" strokeWidth={1.75} />
                Start walkthrough
              </>
            )}
          </button>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
