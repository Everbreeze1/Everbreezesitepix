import { useEffect, useRef, useState } from "react";
import {
  X,
  Loader2,
  RefreshCw,
  Grid3x3,
  Zap,
  ZapOff,
  SwitchCamera,
  Pencil,
  Check,
  Image as ImageIcon,
  Camera as CameraIcon,
  Video as VideoIcon,
  Footprints,
  ArrowLeftRight,
  Tag as TagIcon,
  ScanLine,
  Layers,
  FileDown,
  Crop,
  Mic,
  Plus,
  Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { drawWatermark, type BeforeAfterTag, type WatermarkContext } from "@/lib/watermark";
import { PhotoAnnotator } from "@/features/photos/components/PhotoAnnotator";
import { ScanCrop } from "@/features/photos/components/ScanCrop";
import { TagPill } from "@/features/photos/components/TagPill";

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** Called with the captured (compressed) JPEG and whether to analyze with AI after upload. */
  onCapture: (
    file: File,
    opts: { analyze: boolean; tag: BeforeAfterTag; tags?: string[]; description?: string },
  ) => Promise<void> | void;
  /** Whether the user is allowed to immediately analyze with AI (Pro/Team tier). */
  canAnalyze?: boolean;
  /** Project + company context drawn into the watermark band. */
  watermark?: WatermarkContext;
  /** Existing photo tags shown as chips in the preview step. */
  existingTags?: string[];
  /** Create a new photo tag inline; should return the normalized name. */
  onCreateTag?: (name: string) => Promise<string | null> | string | null;
  /**
   * Quick-capture mode: auto-saves each shot after a brief preview, then
   * resumes the live camera. The user can tap "Annotate" during the preview
   * window to draw on the photo before it's saved.
   */
  autoSave?: boolean;
  /** Milliseconds to show the just-captured photo before auto-saving (autoSave only). */
  autoSaveDelayMs?: number;
  /** If provided, the Walkthrough mode chip closes the camera and calls this to open the walkthrough recorder. */
  onOpenWalkthrough?: () => void;
  /** If provided, the Video mode chip closes the camera and calls this (falls back to walkthrough recorder). */
  onOpenVideo?: () => void;
  /** Enables the Pro/Team "Measure" capture mode chip and post-capture measurement tool. */
  canMeasure?: boolean;
}

// Max width/height for compressed capture
const MAX_DIM = 2048;
const JPEG_QUALITY = 0.85;

export type { BeforeAfterTag };

export function CameraCapture({
  open,
  onClose,
  onCapture,
  canAnalyze = false,
  watermark,
  existingTags = [],
  onCreateTag,
  autoSave = false,
  autoSaveDelayMs = 1400,
  onOpenWalkthrough,
  onOpenVideo,
  canMeasure = false,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [gridOn, setGridOn] = useState(true);
  const [flashOn, setFlashOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [whiteFlash, setWhiteFlash] = useState(false);
  const [starting, setStarting] = useState(false);
  const [tag, setTag] = useState<BeforeAfterTag>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [description, setDescription] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);

  const [preview, setPreview] = useState<{
    dataUrl: string;
    blob: Blob;
    tag: BeforeAfterTag;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [cropping, setCropping] = useState(false);
  // Session capture strip (autoSave mode) - thumbnails of shots saved this session.
  const [sessionShots, setSessionShots] = useState<string[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const autoSaveTimer = useRef<number | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Capture mode selector
  type CaptureMode =
    | "picture"
    | "video"
    | "walkthrough"
    | "before-after"
    | "untagged"
    | "scan"
    | "dual"
    | "measure";
  const [mode, setMode] = useState<CaptureMode>("picture");

  // Post-capture UI state
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const SR: any =
    typeof window !== "undefined"
      ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
      : null;

  const toggleVoice = () => {
    if (!SR) {
      toast.message("Voice input isn't supported in this browser - please type instead.");
      return;
    }
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* noop */
      }
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    let base = description;
    rec.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) base = (base ? base + " " : "") + t.trim();
        else interim += t;
      }
      setDescription((base + (interim ? " " + interim : "")).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  // Level indicator (device tilt in degrees, left/right)
  const [tilt, setTilt] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (typeof e.gamma === "number") setTilt(e.gamma);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [open]);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startStream = async () => {
    setStarting(true);
    try {
      stopStream();
      // Try `exact` first for reliable back-camera selection on iOS/Android,
      // then fall back to `ideal`, then any camera (desktops without rear cam).
      const videoConstraintsList: MediaTrackConstraints[] = [
        { facingMode: { exact: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { width: { ideal: 1280 }, height: { ideal: 720 } },
      ];
      let stream: MediaStream | null = null;
      let lastErr: unknown = null;
      for (const video of videoConstraintsList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!stream) throw lastErr ?? new Error("Could not access camera");
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      // Detect torch capability (Android Chrome usually supports; iOS Safari does not)
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
      };
      setTorchSupported(!!caps.torch);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not access camera. Check permissions.");
      onClose();
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (open && !preview) void startStream();
    return () => {
      if (!open) stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facing]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setPreview(null);
      setSessionShots([]);
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
    }
  }, [open]);

  // In Measure mode, auto-open the annotator (with the Measure tool enabled)
  // as soon as a photo has been captured.
  useEffect(() => {
    if (preview && mode === "measure" && canMeasure && !annotating) {
      setAnnotating(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, mode, canMeasure]);

  const setTorch = async (on: boolean): Promise<boolean> => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  };

  const toggleFlash = () => {
    setFlashOn((v) => !v);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    // Fire the flash for the moment of capture, then turn it off.
    let usedTorch = false;
    if (flashOn) {
      if (torchSupported) {
        usedTorch = await setTorch(true);
      }
      if (!usedTorch) {
        // iOS / unsupported: simulate with a white screen flash
        setWhiteFlash(true);
      }
      // Brief delay so the flash actually illuminates the scene / screen
      await new Promise((r) => setTimeout(r, usedTorch ? 140 : 90));
    }

    const sw = video.videoWidth;
    const sh = video.videoHeight;
    const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (facing === "user") {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(video, 0, 0, w, h);
    }

    // Turn flash back off immediately
    if (usedTorch) await setTorch(false);
    if (!usedTorch && flashOn) {
      setTimeout(() => setWhiteFlash(false), 120);
    }

    // Scan mode: boost contrast and desaturate for document-like output.
    if (mode === "scan") {
      try {
        const img = ctx.getImageData(0, 0, w, h);
        const d = img.data;
        const contrast = 1.35;
        const intercept = 128 * (1 - contrast);
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const v = Math.max(0, Math.min(255, contrast * gray + intercept));
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(img, 0, 0);
      } catch {
        /* ignore */
      }
    }

    await drawWatermark(ctx, w, h, { ...(watermark ?? {}), tag });
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) {
      toast.error("Could not capture photo");
      return;
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    setPreview({ dataUrl, blob, tag });
    if (!autoSave) stopStream();
    // In autoSave mode the auto-save timer is scheduled by an effect that
    // watches `preview`, so it always sees the latest state/closure.
  };

  const retake = async () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    setPreview(null);
    setDescription("");
    if (!autoSave) await startStream();
  };

  const finish = async (opts: { keepOpen?: boolean } = {}) => {
    if (!preview) return;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    setSubmitting(true);
    try {
      const file = new File([preview.blob], `everlumen-${Date.now()}.jpg`, { type: "image/jpeg" });
      const thumb = preview.dataUrl;
      const desc = description.trim();
      await onCapture(file, {
        analyze: false,
        tag: preview.tag,
        tags: selectedTags,
        description: desc || undefined,
      });
      setPreview(null);
      setSelectedTags([]);
      setNewTag("");
      setDescription("");
      if (opts.keepOpen) {
        setSessionShots((s) => [thumb, ...s].slice(0, 8));
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 700);
        // Stream is already running in autoSave mode - nothing to restart.
      } else {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnnotated = async (annotatedBlob: Blob) => {
    if (!preview) return;
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(annotatedBlob);
    });
    const nextPreview = { dataUrl, blob: annotatedBlob, tag: preview.tag };
    setPreview(nextPreview);
    setAnnotating(false);
    // In Measure mode the annotator IS the primary editor - commit straight
    // through so the user doesn't have to tap Save twice.
    if (mode === "measure" && canMeasure) {
      setSubmitting(true);
      try {
        const file = new File([annotatedBlob], `everlumen-measure-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const desc = description.trim();
        await onCapture(file, {
          analyze: false,
          tag: nextPreview.tag,
          tags: selectedTags,
          description: desc || undefined,
        });
        setPreview(null);
        setSelectedTags([]);
        setDescription("");
        onClose();
      } catch (err: any) {
        toast.error(err?.message ?? "Could not save measurement photo");
      } finally {
        setSubmitting(false);
      }
    }
  };

  // Export the current preview as a single-page PDF (Scan mode).
  const exportAsPdf = async () => {
    if (!preview) return;
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    try {
      const { PDFDocument } = await import("pdf-lib");
      const bytes = await preview.blob.arrayBuffer();
      const pdf = await PDFDocument.create();
      const img = await pdf.embedJpg(bytes);
      // Fit onto US Letter (612 x 792 pt) with 24pt margins.
      const pageW = 612;
      const pageH = 792;
      const margin = 24;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const page = pdf.addPage([pageW, pageH]);
      page.drawImage(img, {
        x: (pageW - w) / 2,
        y: (pageH - h) / 2,
        width: w,
        height: h,
      });
      const out = await pdf.save();
      const blob = new Blob([out as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scan-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success("PDF downloaded");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not export PDF");
    }
  };

  // Cancel pending auto-save when the user starts annotating.
  const startAnnotate = () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    setAnnotating(true);
  };

  // Post-capture is now always manual - the preview stays open until the user
  // taps Save, so they can add tags, a description, or annotate first.

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          stopStream();
          setPreview(null);
          onClose();
        }
      }}
    >
      <DialogContent
        className="fixed inset-0 left-0 top-0 z-50 h-screen min-h-[100svh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden border-0 bg-black p-0 text-white duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none sm:rounded-none [&>button[aria-label='Close']]:hidden"
        style={{ width: "100vw", height: "100dvh", maxHeight: "100dvh" }}
      >
        <div className="relative h-full w-full overflow-hidden bg-black">
          {/* Live preview */}
          {!preview && (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`h-full w-full object-cover ${facing === "user" ? "scale-x-[-1]" : ""}`}
              />
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
              {/* Grid overlay */}
              {gridOn && (
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
                  <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
                  <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
                  <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
                </div>
              )}
              {/* Measure mode overlay - Pro/Team only */}
              {mode === "measure" && canMeasure && (
                <>
                  <div className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2">
                    <div className="flex items-center gap-1.5 rounded-full bg-primary/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground shadow-lg ring-1 ring-white/30">
                      <Ruler className="h-3.5 w-3.5" />
                      Pro Measure
                      <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                    </div>
                  </div>
                  <div className="pointer-events-none absolute inset-x-4 bottom-52 z-10 mx-auto max-w-md rounded-2xl bg-black/70 px-4 py-2.5 text-center text-[12px] leading-snug text-white/95 shadow-xl ring-1 ring-white/15 backdrop-blur">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/90 text-primary">
                      Measure Mode
                    </div>
                    Stand approximately <span className="font-semibold text-white">3–6 feet</span>{" "}
                    away. Keep phone{" "}
                    <span className="font-semibold text-white">steady and parallel</span> to the
                    surface for best accuracy.
                  </div>
                  {/* Center reticle */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-24 w-24 rounded-full border-2 border-primary/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.15)]" />
                  </div>
                </>
              )}
            </>
          )}

          {/* Captured preview */}
          {preview && (
            <div className="absolute inset-0 bg-black">
              <img
                src={preview.dataUrl}
                alt="Captured"
                className="h-full w-full object-contain select-none"
                draggable={false}
              />
            </div>
          )}

          {/* White-flash overlay (iOS / unsupported torch fallback) */}
          {whiteFlash && (
            <div className="pointer-events-none absolute inset-0 z-50 animate-pulse bg-white" />
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/60"
              aria-label="Close camera"
              onClick={() => {
                stopStream();
                setPreview(null);
                onClose();
              }}
            >
              <X className="h-5 w-5" />
            </Button>
            {!preview && (
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setGridOn((g) => !g)}
                  className={`h-10 w-10 rounded-full text-white hover:bg-black/60 ${gridOn ? "bg-primary/80" : "bg-black/40"}`}
                  aria-label="Toggle grid"
                >
                  <Grid3x3 className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={toggleFlash}
                  className={`h-10 w-10 rounded-full text-white hover:bg-black/60 ${flashOn ? "bg-safety/90 text-safety-foreground" : "bg-black/40"}`}
                  aria-label="Toggle flash"
                  title={
                    torchSupported
                      ? "Flash will fire on capture"
                      : "Screen flash (iOS) - fires on capture"
                  }
                >
                  {flashOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
                  className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/60"
                  aria-label="Switch camera"
                >
                  <SwitchCamera className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* "Saved" success flash (autoSave only) */}
          {savedFlash && (
            <div className="pointer-events-none absolute right-4 top-4 z-40 flex items-center gap-1.5 rounded-full bg-emerald-500/95 px-3 py-1.5 text-xs font-semibold text-white shadow-lg animate-fade-in">
              <Check className="h-3.5 w-3.5" />
              Saved
            </div>
          )}

          {/* Bottom bar - capture or preview actions */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
            {!preview ? (
              <div className="flex flex-col items-center gap-3">
                {/* Mode selector */}
                <div className="flex w-full max-w-xl items-center gap-2 overflow-x-auto rounded-2xl bg-black/60 p-1.5 ring-1 ring-white/15 backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(
                    [
                      { id: "picture", label: "Picture", icon: CameraIcon },
                      { id: "before-after", label: "Before/After", icon: ArrowLeftRight },
                      ...(canMeasure
                        ? [{ id: "measure" as const, label: "Measure", icon: Ruler }]
                        : []),
                      { id: "untagged", label: "Untagged", icon: TagIcon },
                      { id: "scan", label: "Scan", icon: ScanLine },
                      { id: "video", label: "Video", icon: VideoIcon },
                      { id: "walkthrough", label: "Walkthrough", icon: Footprints },
                      { id: "dual", label: "Dual", icon: Layers },
                    ] as const
                  ).map((m) => {
                    const Icon = m.icon;
                    const active = mode === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          if (m.id === "walkthrough") {
                            const open = onOpenWalkthrough ?? onOpenVideo;
                            if (open) {
                              stopStream();
                              onClose();
                              setTimeout(open, 60);
                              return;
                            }
                            toast.message("Walkthrough mode not available here", {
                              description:
                                "Open the Walkthroughs page to record guided site tours.",
                            });
                            return;
                          }
                          if (m.id === "video") {
                            const open = onOpenVideo ?? onOpenWalkthrough;
                            if (open) {
                              stopStream();
                              onClose();
                              setTimeout(open, 60);
                              return;
                            }
                            toast.message("Video capture uses the Walkthrough recorder", {
                              description:
                                "Open a project and choose Walkthrough to record video with photos.",
                            });
                            return;
                          }
                          if (m.id === "dual") {
                            toast.message("Dual camera is coming soon", {
                              description:
                                "Browsers don't yet allow two camera streams at once on mobile.",
                            });
                            return;
                          }
                          setMode(m.id);
                          if (m.id !== "before-after") setTag(null);
                          if (m.id === "untagged") setSelectedTags([]);
                        }}
                        className={`flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition min-w-[64px] ${
                          active
                            ? "bg-white text-black shadow-md"
                            : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                        aria-pressed={active}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="text-[10px]">{m.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Session thumbnails strip (autoSave) */}
                {autoSave && sessionShots.length > 0 && (
                  <div className="flex w-full max-w-md items-center gap-1.5 overflow-x-auto rounded-xl bg-black/40 p-1.5 ring-1 ring-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <span className="shrink-0 px-1 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                      {sessionShots.length} shot{sessionShots.length === 1 ? "" : "s"}
                    </span>
                    {sessionShots.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-white/20"
                      />
                    ))}
                  </div>
                )}

                {/* Before / After tag selector - only in before-after mode */}
                {mode === "before-after" && (
                  <div className="flex items-center gap-2 rounded-full bg-black/50 p-1 backdrop-blur">
                    <button
                      type="button"
                      onClick={() => setTag(tag === "before" ? null : "before")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition ${
                        tag === "before" ? "bg-white text-black" : "text-white/80 hover:text-white"
                      }`}
                    >
                      BEFORE
                    </button>
                    <button
                      type="button"
                      onClick={() => setTag(null)}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                        tag === null ? "bg-white/15 text-white" : "text-white/60 hover:text-white"
                      }`}
                    >
                      None
                    </button>
                    <button
                      type="button"
                      onClick={() => setTag(tag === "after" ? null : "after")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition ${
                        tag === "after"
                          ? "bg-primary text-primary-foreground"
                          : "text-white/80 hover:text-white"
                      }`}
                    >
                      AFTER
                    </button>
                  </div>
                )}

                {/* Shutter row with gallery import + level indicator */}
                <div className="flex w-full max-w-md items-center justify-between px-4">
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    aria-label="Add from gallery"
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/15 backdrop-blur transition active:scale-95 hover:bg-white/20"
                  >
                    <ImageIcon className="h-5 w-5" />
                  </button>
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (!files.length) return;
                      setSubmitting(true);
                      try {
                        for (const raw of files) {
                          const file = await compressImageFile(raw);
                          await onCapture(file, { analyze: false, tag: null, tags: selectedTags });
                          if (autoSave) {
                            setSessionShots((s) => [URL.createObjectURL(raw), ...s].slice(0, 8));
                          }
                        }
                        toast.success(
                          `Imported ${files.length} photo${files.length === 1 ? "" : "s"}`,
                        );
                        if (!autoSave) onClose();
                      } catch (err: any) {
                        toast.error(err?.message ?? "Could not import photos");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  />

                  <button
                    onClick={capture}
                    disabled={starting || submitting}
                    aria-label="Capture photo"
                    className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/10 ring-4 ring-black/40 transition active:scale-95 disabled:opacity-50"
                  >
                    <span className="h-12 w-12 rounded-full bg-white" />
                  </button>

                  {/* Level indicator */}
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur"
                    aria-label="Level indicator"
                    title={tilt == null ? "Level not available" : `Tilt: ${tilt.toFixed(0)}°`}
                  >
                    {tilt == null ? (
                      <span className="text-[9px] font-semibold text-white/50">LVL</span>
                    ) : (
                      <div className="relative h-8 w-8">
                        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/40" />
                        <div
                          className={`absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full transition-colors ${
                            Math.abs(tilt) < 2 ? "bg-emerald-400" : "bg-amber-400"
                          }`}
                          style={{
                            transform: `translateY(-50%) rotate(${Math.max(-45, Math.min(45, tilt))}deg)`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {autoSave && (
                  <p className="text-[10px] text-white/60">
                    {mode === "scan"
                      ? "Scan mode · high-contrast document capture"
                      : "Tap the shutter - add tags, notes, or annotate before saving"}
                  </p>
                )}
              </div>
            ) : (
              // Unified post-capture UI - clean bottom toolbar, tag sheet, prominent mic.
              <div className="mx-auto flex w-full max-w-md flex-col gap-3">
                <div className="flex items-center justify-around gap-1 rounded-2xl bg-black/60 p-2 ring-1 ring-white/15 backdrop-blur">
                  <ToolbarButton
                    icon={RefreshCw}
                    label="Retake"
                    onClick={retake}
                    disabled={submitting}
                  />
                  <ToolbarButton
                    icon={Pencil}
                    label="Annotate"
                    onClick={startAnnotate}
                    disabled={submitting}
                  />
                  <ToolbarButton
                    icon={TagIcon}
                    label="Tags"
                    onClick={() => setTagSheetOpen(true)}
                    disabled={submitting}
                    badge={selectedTags.length || undefined}
                  />
                  <ToolbarButton
                    icon={Mic}
                    label={listening ? "Stop" : "Voice"}
                    onClick={toggleVoice}
                    disabled={submitting}
                    active={listening}
                    prominent
                  />
                  {mode === "scan" && (
                    <>
                      <ToolbarButton
                        icon={Crop}
                        label="Crop"
                        onClick={() => setCropping(true)}
                        disabled={submitting}
                      />
                      <ToolbarButton
                        icon={FileDown}
                        label="PDF"
                        onClick={exportAsPdf}
                        disabled={submitting}
                      />
                    </>
                  )}
                </div>

                <Button
                  onClick={() => finish({ keepOpen: autoSave })}
                  disabled={submitting}
                  className="h-14 w-full rounded-2xl bg-white text-base font-semibold text-black shadow-lg hover:bg-white/90"
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-5 w-5" />
                  )}
                  Save Photo
                </Button>
              </div>
            )}
          </div>

          {/* Overlays on top of the photo preview */}
          {preview && selectedTags.length > 0 && (
            <div className="pointer-events-none absolute left-4 right-4 top-20 flex flex-wrap gap-1.5">
              {selectedTags.map((t) => (
                <TagPill key={t} name={t} size="sm" />
              ))}
            </div>
          )}
          {preview && (description || listening) && (
            <div className="pointer-events-none absolute bottom-40 left-4 max-w-[75%] rounded-2xl bg-black/70 px-3.5 py-2.5 text-sm leading-snug text-white shadow-lg ring-1 ring-white/20 backdrop-blur">
              {listening && (
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" />
              )}
              {description || <span className="italic text-white/70">Listening…</span>}
            </div>
          )}
        </div>

        {/* Helper hint */}
        {!preview && (
          <div className="hidden border-t border-white/10 px-4 py-2 text-center text-[11px] text-white/60 sm:block">
            Tip: hold steady, use the grid for level shots, and tap the bolt for low light.
          </div>
        )}
      </DialogContent>

      {/* Tag picker sheet */}
      <Sheet open={tagSheetOpen} onOpenChange={setTagSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-white/10 bg-neutral-950 text-white"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-white">Tag this photo</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-wrap gap-2">
            {existingTags.length === 0 && (
              <p className="text-sm text-white/60">No tags yet - add one below.</p>
            )}
            {existingTags.map((t) => {
              const on = selectedTags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    setSelectedTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))
                  }
                  className={`rounded-full transition ${on ? "ring-2 ring-white scale-105" : "opacity-70 hover:opacity-100"}`}
                  aria-pressed={on}
                >
                  <TagPill name={t} size="md" />
                </button>
              );
            })}
          </div>
          {onCreateTag && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const v = newTag.trim();
                if (!v || creatingTag) return;
                setCreatingTag(true);
                try {
                  const norm = await onCreateTag(v);
                  if (norm && !selectedTags.includes(norm)) setSelectedTags((s) => [...s, norm]);
                  setNewTag("");
                } finally {
                  setCreatingTag(false);
                }
              }}
              className="mt-5 flex items-center gap-2"
            >
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Create new tag…"
                maxLength={32}
                className="h-11 flex-1 rounded-xl bg-white/10 px-3 text-sm text-white placeholder:text-white/40 outline-none ring-1 ring-white/15 focus:ring-white/40"
              />
              <Button
                type="submit"
                disabled={!newTag.trim() || creatingTag}
                className="h-11 rounded-xl bg-white text-black hover:bg-white/90"
              >
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </form>
          )}
          <div className="mt-5 flex justify-end">
            <Button
              onClick={() => setTagSheetOpen(false)}
              className="bg-white text-black hover:bg-white/90"
            >
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      {preview && (
        <PhotoAnnotator
          open={annotating}
          imageUrl={preview.dataUrl}
          onClose={() => setAnnotating(false)}
          onSave={handleAnnotated}
          canMeasure={canMeasure}
          initialTool={mode === "measure" && canMeasure ? "measure" : undefined}
        />
      )}
      {preview && (
        <ScanCrop
          open={cropping}
          imageUrl={preview.dataUrl}
          onCancel={() => setCropping(false)}
          onApply={async (blob) => {
            const dataUrl = await new Promise<string>((resolve) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result as string);
              r.readAsDataURL(blob);
            });
            setPreview({ dataUrl, blob, tag: preview.tag });
            setCropping(false);
            toast.success("Document cropped");
          }}
        />
      )}
    </Dialog>
  );
}

/**
 * Compress an existing image file the same way the camera does.
 * Iteratively reduces quality (and dimension if needed) to stay under MAX_BYTES (~2 MB).
 * Returns the original file if it's already small enough.
 */
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap per photo

export async function compressImageFile(
  file: File,
  maxDim = MAX_DIM,
  quality = JPEG_QUALITY,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= MAX_BYTES && file.size < 1_500_000) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  let dim = maxDim;
  let q = quality;
  let out: Blob | null = null;
  // Up to 5 attempts: shrink dim & quality until under cap
  for (let i = 0; i < 5; i++) {
    const scale = Math.min(1, dim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", q),
    );
    if (!out) break;
    if (out.size <= MAX_BYTES) break;
    // Tighten for next pass
    q = Math.max(0.55, q - 0.1);
    dim = Math.round(dim * 0.85);
  }
  if (!out) return file;
  return new File([out], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

// ---------------------------------------------------------------------------
// Bottom-toolbar icon button for the post-capture preview.
// ---------------------------------------------------------------------------
function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
  prominent,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  prominent?: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition active:scale-95 disabled:opacity-40 ${
        active
          ? "bg-red-600 text-white shadow-lg ring-1 ring-red-400"
          : prominent
            ? "bg-white/15 text-white hover:bg-white/25"
            : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon className={`${prominent ? "h-7 w-7" : "h-6 w-6"} ${active ? "animate-pulse" : ""}`} />
      <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      {badge ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
