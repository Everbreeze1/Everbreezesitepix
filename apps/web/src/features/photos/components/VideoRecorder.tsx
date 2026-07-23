import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Square, Video, X, Save, RefreshCw, Lock } from "lucide-react";

interface VideoRecorderProps {
  open: boolean;
  onClose: () => void;
  /** Max video length in seconds (Starter: 300, Team: 600). */
  maxSeconds: number;
  /** Whether the user has access (active sub/trial). */
  canRecord: boolean;
  /** Tier label for the upgrade prompt. */
  tierLabel: string;
  onSave: (
    file: File,
    opts: { durationSeconds: number; transcript: string },
  ) => Promise<void> | void;
}

type Phase = "idle" | "recording" | "preview" | "saving";

export function VideoRecorder({
  open,
  onClose,
  maxSeconds,
  canRecord,
  tierLabel,
  onSave,
}: VideoRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const mimeRef = useRef<string>("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [starting, setStarting] = useState(false);
  const [recorded, setRecorded] = useState<{ blob: Blob; url: string; duration: number } | null>(
    null,
  );

  const stopAll = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopAll();
      setPhase("idle");
      setElapsed(0);
      setRecorded((r) => {
        if (r?.url) URL.revokeObjectURL(r.url);
        return null;
      });
    }
    return () => {
      if (!open) stopAll();
    };
  }, [open, stopAll]);

  const startRecording = async () => {
    if (!canRecord || starting) return;
    setStarting(true);
    chunksRef.current = [];
    setElapsed(0);

    // Prioritized back-camera constraints
    const videoConstraintsList: MediaTrackConstraints[] = [
      { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { width: { ideal: 1280 }, height: { ideal: 720 } },
    ];
    let stream: MediaStream | null = null;
    let lastErr: unknown = null;
    for (const video of videoConstraintsList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video,
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!stream) {
      toast.error((lastErr as any)?.message ?? "Could not access camera/microphone");
      setStarting(false);
      return;
    }
    streamRef.current = stream;

    if (videoRef.current) {
      const v = videoRef.current;
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      try {
        await v.play();
      } catch {
        /* user gesture should cover */
      }
    }

    // Choose a reliable mime
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : MediaRecorder.isTypeSupported("video/mp4")
            ? "video/mp4"
            : "";
    mimeRef.current = mime;

    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond: 2_000_000,
            audioBitsPerSecond: 96_000,
          })
        : new MediaRecorder(stream);
    } catch (e: any) {
      toast.error(e?.message ?? "This device can't record video in the browser");
      stopAll();
      setStarting(false);
      return;
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = chunksRef.current[0]?.type || mimeRef.current || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      const duration = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      if (blob.size === 0) {
        toast.error("Recording was empty — your browser couldn't capture this format. Try again.");
        setPhase("idle");
      } else {
        const url = URL.createObjectURL(blob);
        setRecorded({ blob, url, duration });
        setPhase("preview");
      }
    };

    startedAtRef.current = Date.now();
    recorder.start(1000);
    setPhase("recording");
    setStarting(false);

    timerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(sec);
      if (sec >= maxSeconds) {
        try {
          recorder.requestData();
        } catch {}
        try {
          recorder.stop();
        } catch {}
        toast.message(`Reached the ${Math.round(maxSeconds / 60)}-minute limit`);
      }
    }, 250);
  };

  const stopRecording = () => {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    try {
      r.requestData();
    } catch {}
    try {
      r.stop();
    } catch {}
  };

  const retake = () => {
    if (recorded?.url) URL.revokeObjectURL(recorded.url);
    setRecorded(null);
    setElapsed(0);
    setPhase("idle");
  };

  const saveRecording = async () => {
    if (!recorded) return;
    setPhase("saving");
    try {
      const ext = recorded.blob.type.includes("mp4") ? "mp4" : "webm";
      const file = new File([recorded.blob], `sitepix-video-${Date.now()}.${ext}`, {
        type: recorded.blob.type,
      });
      await onSave(file, { durationSeconds: recorded.duration, transcript: "" });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save video");
      setPhase("preview");
    }
  };

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && phase !== "saving") onClose();
      }}
    >
      <DialogContent className="max-w-3xl border-0 bg-black p-0 text-white sm:rounded-2xl [&>button[aria-label='Close']]:hidden">
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-black sm:aspect-video">
          {!canRecord ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <Lock className="h-10 w-10 text-white/70" />
              <h3 className="text-lg font-semibold">
                Video recording requires an active subscription
              </h3>
              <p className="max-w-md text-sm text-white/70">
                Record site videos — up to 5 minutes on Starter, 10 minutes on Team.
              </p>
              <Button
                onClick={onClose}
                variant="secondary"
                className="bg-white text-black hover:bg-white/90"
              >
                Close
              </Button>
            </div>
          ) : phase === "preview" && recorded ? (
            <video
              ref={previewRef}
              src={recorded.url}
              controls
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="h-full w-full object-cover"
              />
              {phase === "idle" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65 p-6 text-center">
                  <Video className="h-10 w-10" />
                  <h3 className="text-lg font-semibold">Record a site video</h3>
                  <p className="max-w-sm text-sm text-white/70">
                    {tierLabel}: up to {Math.round(maxSeconds / 60)} minutes.
                  </p>
                  <Button
                    onClick={startRecording}
                    disabled={starting}
                    className="mt-1 h-12 rounded-full bg-red-600 px-6 text-base font-semibold text-white shadow-lg hover:bg-red-500"
                  >
                    {starting ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Video className="mr-2 h-5 w-5" />
                    )}
                    Start recording
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/60"
              aria-label="Close"
              onClick={() => {
                if (phase !== "saving") onClose();
              }}
            >
              <X className="h-5 w-5" />
            </Button>
            {phase === "recording" && (
              <div className="flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1 text-sm font-semibold tabular-nums shadow-lg">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                REC {fmtTime(elapsed)} / {fmtTime(maxSeconds)}
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
            {phase === "recording" && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={stopRecording}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    stopRecording();
                  }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-white ring-4 ring-red-600/40 transition active:scale-95"
                  aria-label="Stop recording"
                >
                  <Square className="h-6 w-6 fill-red-600 text-red-600" />
                </button>
              </div>
            )}
            {phase === "preview" && recorded && (
              <div className="flex flex-col items-center gap-3">
                <div className="flex w-full max-w-md gap-2">
                  <Button
                    variant="secondary"
                    onClick={retake}
                    className="flex-1 bg-white/10 text-white hover:bg-white/20"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Re-record
                  </Button>
                  <Button
                    onClick={saveRecording}
                    className="flex-1 bg-white text-black hover:bg-white/90"
                  >
                    <Save className="mr-2 h-4 w-4" /> Save to project
                  </Button>
                </div>
                <div className="text-[11px] text-white/60">
                  {Math.round(recorded.blob.size / 1024 / 1024)} MB · {fmtTime(recorded.duration)}
                </div>
              </div>
            )}
            {phase === "saving" && (
              <div className="flex flex-col items-center gap-2 text-white/80">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Uploading video…</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
