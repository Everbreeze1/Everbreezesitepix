import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Loader2,
  Mic,
  MicOff,
  Square,
  X,
  Camera,
  Lock,
  Sparkles,
  Footprints,
  SwitchCamera,
  PictureInPicture2,
} from "lucide-react";
import { drawWatermark, type WatermarkContext } from "@/lib/watermark";
import { devLog } from "@/lib/dev-log";
import { compressImageFile } from "@/features/photos/components/CameraCapture";

interface WalkthroughRecorderProps {
  open: boolean;
  onClose: () => void;
  /** Per-walkthrough hard cap in seconds. Pro = 600, Team = 1200 (Pro-gated feature). */
  maxSeconds: number;
  canRecord: boolean;
  tierLabel: string;
  watermark?: WatermarkContext;
  /** Called per captured frame. Should upload, link to the active walkthrough, and return the new photo id. */
  onCapturePhoto: (
    file: File,
    meta: { offsetSeconds: number; position: number },
  ) => Promise<string | null>;
  /**
   * Called when recording stops cleanly. Receives the recorded video+audio
   * blob + photo timeline. The parent saves the row first, then uploads the
   * video/report in the background so mobile video conversion cannot block
   * the walkthrough card from being created.
   */
  onFinish: (data: {
    mediaBlob: Blob | null;
    mediaMimeType: string | null;
    durationSeconds: number;
    photos: Array<{ photoId: string; offsetSeconds: number }>;
    audioBlob?: Blob | null;
    audioMimeType?: string | null;
    /** Live transcript captured during recording when browser speech is safe.
     *  Empty string if live STT was unavailable; the saved audio is still
     *  transcribed server-side after recording stops. */
    liveTranscript: string;
  }) => Promise<void> | void;
  /**
   * Tapped while the post-stop processing overlay is showing. Should take
   * the user to a safe destination (e.g. the walkthrough page) without
   * deleting the in-flight walkthrough. Falls back to onClose if omitted.
   */
  onContinueInBackground?: () => void;
}

type Phase = "idle" | "recording" | "finishing";

interface CapturedPhoto {
  id: string;
  offsetSeconds: number;
  thumbDataUrl: string;
}

function pickMediaMime(): string {
  // Prefer formats that Whisper accepts natively AND that mobile browsers can record.
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "video/webm";
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {}
  }
  return "video/webm";
}

// 8 kHz mono PCM keeps even a 10-minute walkthrough comfortably small enough
// for immediate transcription while preserving spoken-word clarity.
const TRANSCRIPTION_SAMPLE_RATE = 8_000;

function downsampleToInt16(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate = TRANSCRIPTION_SAMPLE_RATE,
) {
  if (!input.length) return new Int16Array(0);
  const ratio = Math.max(1, inputSampleRate / outputSampleRate);
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    const count = Math.max(1, end - start);
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / count));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function encodePcmWav(chunks: Int16Array[], sampleRate = TRANSCRIPTION_SAMPLE_RATE) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (sampleCount < sampleRate * 0.25) return null;
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, sampleCount * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, offset += 2) view.setInt16(offset, chunk[i] ?? 0, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function WalkthroughRecorder({
  open,
  onClose,
  maxSeconds,
  canRecord,
  tierLabel,
  watermark,
  onCapturePhoto,
  onFinish,
  onContinueInBackground,
}: WalkthroughRecorderProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selfStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const pcmChunksRef = useRef<Int16Array[]>([]);
  const mediaMimeRef = useRef<string>("video/webm");
  const audioMimeRef = useRef<string>("audio/wav");
  const startedAtRef = useRef<number>(0);
  const photosRef = useRef<CapturedPhoto[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmInputSampleRateRef = useRef<number>(48_000);
  const rafRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const facingRef = useRef<"environment" | "user">("environment");
  const speechRestartTimeoutRef = useRef<number | null>(null);
  const stoppingSpeechRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [micLive, setMicLive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [livePartial, setLivePartial] = useState("");
  const [liveCommitted, setLiveCommitted] = useState("");
  const [finishError, setFinishError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [flipping, setFlipping] = useState(false);
  const [selfActive, setSelfActive] = useState(false);
  const [postRecordTranscriptionOnly, setPostRecordTranscriptionOnly] = useState(false);

  const stopMicMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      pcmProcessorRef.current?.disconnect();
    } catch {}
    pcmProcessorRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const startMicMeter = useCallback((stream: MediaStream) => {
    try {
      const AC: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      pcmInputSampleRateRef.current = ctx.sampleRate;
      pcmChunksRef.current = [];
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const output = event.outputBuffer.getChannelData(0);
        output.fill(0);
        const downsampled = downsampleToInt16(input, ctx.sampleRate);
        if (downsampled.length) pcmChunksRef.current.push(downsampled);
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      pcmProcessorRef.current = processor;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        // Map RMS to a 0..1 level with a gentle curve so quiet speech still moves the bar.
        const level = Math.min(1, Math.pow(rms * 3.2, 0.7));
        setMicLevel(level);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      console.warn("Mic meter failed", e);
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    stoppingSpeechRef.current = true;
    if (speechRestartTimeoutRef.current) {
      window.clearTimeout(speechRestartTimeoutRef.current);
      speechRestartTimeoutRef.current = null;
    }
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
    } catch {}
    try {
      rec.stop();
    } catch {}
    recognitionRef.current = null;
  }, []);

  const stopSelfView = useCallback(() => {
    selfStreamRef.current?.getTracks().forEach((t) => t.stop());
    selfStreamRef.current = null;
    if (selfVideoRef.current) {
      try {
        selfVideoRef.current.srcObject = null;
      } catch {}
    }
    setSelfActive(false);
  }, []);

  const stopAll = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {}
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopSelfView();
    stopMicMeter();
    setMicLive(false);
    stopSpeechRecognition();
  }, [stopMicMeter, stopSpeechRecognition, stopSelfView]);

  useEffect(() => {
    if (!open) {
      stopAll();
      setPhase("idle");
      setElapsed(0);
      setPhotos([]);
      photosRef.current = [];
      setLivePartial("");
      setLiveCommitted("");
      setFinishError(null);
      setMuted(false);
      setPostRecordTranscriptionOnly(false);
      setFacing("environment");
      facingRef.current = "environment";
      mediaChunksRef.current = [];
      pcmChunksRef.current = [];
    }
    return () => {
      if (!open) stopAll();
    };
  }, [open, stopAll]);

  const toggleMute = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const next = !muted;
    s.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
    if (next) {
      toast.message("Microphone muted — narration won't be recorded while muted.");
    }
  }, [muted]);

  const flipCamera = useCallback(async () => {
    const s = streamRef.current;
    if (!s || flipping) return;
    devLog("[walkthrough] flip camera requested", { from: facingRef.current });
    setFlipping(true);
    const target = facingRef.current === "environment" ? "user" : "environment";
    const audioTracks = s.getAudioTracks();
    const currentFacing = facingRef.current;

    try {
      recorderRef.current?.pause?.();
    } catch {}
    // Android Chrome often refuses to open the other camera while the current
    // camera track (or the optional self-view camera) is still active. Release
    // video first, but keep the original mic track alive so audio recording
    // continues and the system mic permission doesn't re-chime.
    stopSelfView();

    const devices = await navigator.mediaDevices
      .enumerateDevices()
      .catch(() => [] as MediaDeviceInfo[]);
    const videoInputs = devices.filter((d) => d.kind === "videoinput");
    const currentTrack = s.getVideoTracks()[0];
    const currentSettings = currentTrack?.getSettings?.() ?? {};
    const currentDeviceId = (currentSettings as MediaTrackSettings).deviceId;
    const labelMatch = (d: MediaDeviceInfo) => {
      const label = d.label.toLowerCase();
      return target === "environment"
        ? /back|rear|environment|wide|0\.5|1x/.test(label)
        : /front|user|face|selfie/.test(label);
    };
    const preferredDevice = videoInputs.find(
      (d) => d.deviceId !== currentDeviceId && labelMatch(d),
    );
    const constraintsList: MediaTrackConstraints[] = [
      ...(preferredDevice
        ? [
            {
              deviceId: { exact: preferredDevice.deviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            } as MediaTrackConstraints,
          ]
        : []),
      { facingMode: { exact: target }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { facingMode: { ideal: target }, width: { ideal: 1280 }, height: { ideal: 720 } },
      ...videoInputs
        .filter((d) => d.deviceId !== currentDeviceId && d.deviceId !== preferredDevice?.deviceId)
        .slice(0, 4)
        .map(
          (d) =>
            ({
              deviceId: { exact: d.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }) as MediaTrackConstraints,
        ),
    ];

    const openVideoTrack = async (constraints: MediaTrackConstraints[]) => {
      for (const v of constraints) {
        try {
          devLog("[walkthrough] trying camera constraint", v);
          const nextStream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
          const track = nextStream.getVideoTracks()[0];
          if (track) return track;
          nextStream.getTracks().forEach((t) => t.stop());
        } catch (e) {
          console.warn("[walkthrough] camera constraint failed", e);
        }
      }
      return null;
    };

    if (currentTrack) {
      try {
        s.removeTrack(currentTrack);
      } catch {}
      try {
        currentTrack.stop();
      } catch {}
    }

    const newStream: MediaStream | null = null;
    const newTrack = await openVideoTrack(constraintsList);
    if (!newTrack) {
      const restoreConstraints: MediaTrackConstraints[] = [
        ...(currentDeviceId
          ? [
              {
                deviceId: { exact: currentDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              } as MediaTrackConstraints,
            ]
          : []),
        { facingMode: { ideal: currentFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      ];
      const restoredTrack = await openVideoTrack(restoreConstraints);
      if (restoredTrack) {
        try {
          s.addTrack(restoredTrack);
        } catch {}
        if (videoRef.current) {
          try {
            videoRef.current.srcObject = s;
            await videoRef.current.play().catch(() => {});
          } catch {}
        }
      }
      toast.error("Couldn't switch cameras on this device.");
      setFlipping(false);
      try {
        recorderRef.current?.resume?.();
      } catch {}
      return;
    }
    try {
      s.addTrack(newTrack);
    } catch {}
    // Keep audio tracks untouched; Android can beep when getUserMedia is
    // repeatedly asked for mic access, so camera flips are video-only.
    audioTracks.forEach((track) => {
      if (!s.getAudioTracks().includes(track)) {
        try {
          s.addTrack(track);
        } catch {}
      }
    });
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = s;
        await videoRef.current.play().catch(() => {});
      } catch {}
    }
    facingRef.current = target;
    setFacing(target);
    setFlipping(false);
    try {
      recorderRef.current?.resume?.();
    } catch {}
    devLog("[walkthrough] camera flipped", {
      to: target,
      deviceId: newTrack.getSettings?.().deviceId,
    });
    // Front-facing main view + PiP self-view is redundant — turn PiP off.
    if (target === "user") stopSelfView();
  }, [flipping, stopSelfView]);

  const toggleSelfView = useCallback(async () => {
    if (selfActive) {
      stopSelfView();
      return;
    }
    // Can't usefully PiP when the main view is already front-facing.
    if (facingRef.current === "user") {
      toast.message("Flip to the rear camera to use self-view.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" }, width: { ideal: 320 }, height: { ideal: 320 } },
        audio: false,
      });
      selfStreamRef.current = stream;
      if (selfVideoRef.current) {
        selfVideoRef.current.srcObject = stream;
        selfVideoRef.current.muted = true;
        selfVideoRef.current.playsInline = true;
        try {
          await selfVideoRef.current.play();
        } catch {}
      }
      setSelfActive(true);
    } catch (e: any) {
      toast.error(
        "Self-view isn't available on this device (most phones can't open two cameras at once).",
      );
    }
  }, [selfActive, stopSelfView]);

  const start = async () => {
    if (!canRecord) return;
    devLog("[walkthrough] Starting...");
    devLog("[walkthrough] recorder start requested");
    setStarting(true);

    // Single getUserMedia call for both camera preview AND microphone capture.
    // Recording audio with MediaRecorder is far more reliable than live Scribe
    // on mobile — we batch-transcribe server-side after stop for accuracy.
    let stream: MediaStream;
    try {
      // Prefer the rear camera on phones. Try `exact` first for reliable
      // back-camera selection on iOS/Android, then fall back to `ideal`
      // (laptops without a rear camera), then any camera.
      const videoConstraintsList: MediaTrackConstraints[] = [
        { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        { width: { ideal: 1280 }, height: { ideal: 720 } },
      ];
      let lastErr: unknown = null;
      stream = null as unknown as MediaStream;
      for (const video of videoConstraintsList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: true,
              channelCount: { ideal: 1 },
              sampleRate: { ideal: 48_000 },
            },
          });
          devLog("[walkthrough] media stream acquired", {
            video: stream.getVideoTracks()[0]?.getSettings?.(),
            audioTracks: stream.getAudioTracks().length,
            audio: stream.getAudioTracks()[0]?.getSettings?.(),
          });
          break;
        } catch (err) {
          lastErr = err;
          stream = null as unknown as MediaStream;
        }
      }
      if (!stream) throw lastErr ?? new Error("Could not access camera");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not access camera/microphone");
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
        /* user gesture should cover this */
      }
    }

    // Single MediaRecorder on the FULL A/V stream — this is the saved playback
    // file, so it must keep the microphone track attached for narration.
    mediaChunksRef.current = [];
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      toast.error("No microphone detected — We can't transcribe without audio.");
      stopAll();
      setStarting(false);
      return;
    }
    const mime = pickMediaMime();
    mediaMimeRef.current = mime;
    try {
      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 1_200_000,
        audioBitsPerSecond: 96_000,
      });
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          mediaChunksRef.current.push(ev.data);
          devLog("[walkthrough] media chunk", {
            bytes: ev.data.size,
            chunks: mediaChunksRef.current.length,
          });
        }
      };
      rec.onerror = (ev) => {
        console.warn("[walkthrough] media recorder error", ev);
      };
      rec.start(1000); // 1s chunks → forces flush on mobile Safari
      recorderRef.current = rec;
      setMicLive(true);
      // Mic-level meter also records a clean WAV transcription track.
      // This avoids running a second MediaRecorder on the same mic, which can
      // make Android Chrome drop audio or repeatedly chime permission changes.
      startMicMeter(new MediaStream(audioTracks));

      // Do not use browser-native SpeechRecognition during walkthroughs. Mobile
      // browsers often play audible mic chimes when Web Speech starts/stops,
      // and it can compete with MediaRecorder for the mic. We record a clean
      // WAV sidecar and transcribe it immediately after Stop instead.
      setLivePartial("");
      setLiveCommitted("");
      setPostRecordTranscriptionOnly(true);
      devLog(
        "[walkthrough] native live speech recognition disabled; stable WAV transcription will run after stop",
      );
    } catch (e: any) {
      console.warn("[walkthrough] media recorder failed", e);
      toast.error("Video recording is not supported on this device.");
      stopAll();
      setStarting(false);
      return;
    }

    setStarting(false);
    startedAtRef.current = Date.now();
    setElapsed(0);
    setPhase("recording");
    devLog("[walkthrough] recorder started", { mime, maxSeconds });
    timerRef.current = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(sec);
      if (sec >= maxSeconds) {
        toast.message(`Reached the ${Math.round(maxSeconds / 60)}-minute walkthrough limit`);
        void finish();
      }
    }, 250);
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || capturing) return;
    setCapturing(true);
    try {
      devLog("[walkthrough] capture photo requested", {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });
      const sw = video.videoWidth;
      const sh = video.videoHeight;
      const MAX = 2048;
      const scale = Math.min(1, MAX / Math.max(sw, sh));
      const w = Math.round(sw * scale);
      const h = Math.round(sh * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      await drawWatermark(ctx, w, h, { ...(watermark ?? {}), tag: null });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
      );
      if (!blob) {
        toast.error("Could not capture photo");
        return;
      }
      const offset = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const file = await compressImageFile(
        new File([blob], `walkthrough-${Date.now()}.jpg`, { type: "image/jpeg" }),
      );
      const position = photosRef.current.length;
      const id = await onCapturePhoto(file, { offsetSeconds: offset, position });
      if (!id) return;

      const thumbDataUrl = canvas.toDataURL("image/jpeg", 0.5);
      const nextPhoto = { id, offsetSeconds: offset, thumbDataUrl };
      photosRef.current = [...photosRef.current, nextPhoto];
      setPhotos(photosRef.current);
      devLog("[walkthrough] capture photo saved locally", {
        photoId: id,
        offsetSeconds: offset,
        position,
      });
      toast.success("Photo captured");
    } finally {
      setCapturing(false);
    }
  };

  const finish = async () => {
    if (phase === "finishing") return;
    devLog("[walkthrough] Recording stopped");
    devLog("[walkthrough] recorder finish requested", {
      photos: photosRef.current.length,
      chunks: mediaChunksRef.current.length,
    });
    setPhase("finishing");
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;

    // Flush + stop MediaRecorder, await final data event before reading chunks.
    let mediaBlob: Blob | null = null;
    let audioBlob: Blob | null = null;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        // Some Android WebView/Chrome builds do not reliably fire `onstop`
        // after `requestData()`. Never let that block the database save — the
        // walkthrough card and linked photos are more important than video.
        const timeout = window.setTimeout(done, 2500);
        rec.onstop = () => {
          devLog("[walkthrough] media recorder stopped");
          window.clearTimeout(timeout);
          done();
        };
        try {
          rec.requestData();
        } catch {}
        try {
          rec.stop();
        } catch {
          window.clearTimeout(timeout);
          done();
        }
      });
      if (mediaChunksRef.current.length) {
        mediaBlob = new Blob(mediaChunksRef.current, { type: mediaMimeRef.current });
      }
    }
    recorderRef.current = null;
    audioBlob = encodePcmWav(pcmChunksRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMicLive(false);
    stopMicMeter();
    stopSpeechRecognition();

    const duration = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000));

    let mediaMimeType: string | null = null;
    if (mediaBlob && mediaBlob.size > 0) {
      mediaMimeType = mediaMimeRef.current;
    }
    devLog("[walkthrough] recorder media finalized", {
      hasMedia: !!mediaBlob,
      bytes: mediaBlob?.size ?? 0,
      mime: mediaMimeType,
      mediaChunks: mediaChunksRef.current.length,
    });
    devLog("[walkthrough] recorder audio finalized", {
      hasAudio: !!audioBlob,
      bytes: audioBlob?.size ?? 0,
      mime: audioBlob ? audioMimeRef.current : null,
      pcmChunks: pcmChunksRef.current.length,
      inputSampleRate: pcmInputSampleRateRef.current,
    });

    try {
      const liveTranscript = [liveCommitted, livePartial].filter(Boolean).join(" ").trim();
      await onFinish({
        mediaBlob,
        mediaMimeType,
        durationSeconds: duration,
        photos: photosRef.current.map((p) => ({ photoId: p.id, offsetSeconds: p.offsetSeconds })),
        audioBlob,
        audioMimeType: audioBlob ? audioMimeRef.current : null,
        liveTranscript,
      });
    } catch (e: any) {
      console.warn("[walkthrough] finish failed", e);
      setFinishError(
        "We couldn't save your walkthrough. Your recording is still on this device — please try again.",
      );
    }
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && phase !== "finishing") onClose();
      }}
    >
      <DialogContent
        className="fixed inset-0 left-0 top-0 z-50 h-screen min-h-[100svh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden border-0 bg-black p-0 text-white duration-0 data-[state=open]:animate-none data-[state=closed]:animate-none sm:rounded-none [&>button[aria-label='Close']]:hidden"
        style={{ width: "100vw", height: "100dvh", maxHeight: "100dvh" }}
      >
        <div
          className="relative h-screen min-h-[100svh] w-screen overflow-hidden bg-black"
          style={{ height: "100dvh" }}
        >
          {!canRecord ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
              <Lock className="h-10 w-10 text-white/70" />
              <h3 className="text-lg font-semibold">Walkthrough Notes are a Pro feature</h3>
              <p className="max-w-md text-sm text-white/70">
                Walk the job, speak naturally, snap photos as you go — our AI turns it all into a
                polished, client-ready report. Up to 10 minutes per note on Pro, 20 minutes on Team.
              </p>
              <Button
                onClick={onClose}
                variant="secondary"
                className="bg-white text-black hover:bg-white/90"
              >
                Close
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`h-full w-full object-cover ${facing === "user" ? "scale-x-[-1]" : ""}`}
              />

              {/* PiP self-view */}
              {selfActive && (
                <div className="absolute right-3 top-16 z-10 h-28 w-20 overflow-hidden rounded-xl border-2 border-white/80 bg-black shadow-xl sm:h-32 sm:w-24">
                  <video
                    ref={selfVideoRef}
                    playsInline
                    muted
                    autoPlay
                    className="h-full w-full scale-x-[-1] object-cover"
                  />
                </div>
              )}

              {phase === "idle" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65 p-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/90">
                    <Footprints className="h-7 w-7" />
                  </div>
                  <h3 className="text-xl font-semibold">Start your Walkthrough Note</h3>
                  <p className="max-w-md text-sm text-white/70">
                    {tierLabel} · up to {Math.round(maxSeconds / 60)} min. Speak naturally about
                    what you see — we record your narration, snaps the photos you take, and writes a
                    clean report based purely on what you said.
                  </p>
                  <Button
                    onClick={start}
                    disabled={starting}
                    className="mt-1 h-12 rounded-full bg-red-600 px-6 text-base font-semibold text-white shadow-lg hover:bg-red-500"
                  >
                    {starting ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Mic className="mr-2 h-5 w-5" />
                    )}
                    Start walkthrough
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 rounded-full bg-black/40 text-white hover:bg-black/60"
              aria-label="Close"
              onClick={() => {
                if (phase !== "finishing") onClose();
              }}
            >
              <X className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              {phase === "recording" && (
                <div className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-3 py-1 text-sm font-semibold shadow-lg">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                  REC {fmtTime(elapsed)}
                </div>
              )}
              {phase === "recording" && (
                <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs">
                  <Camera className="h-3.5 w-3.5" /> {photos.length}
                </div>
              )}
            </div>
          </div>

          {/* Photo strip */}
          {phase === "recording" && photos.length > 0 && (
            <div className="absolute inset-x-3 bottom-[13.5rem] flex gap-1.5 overflow-x-auto pb-1 sm:bottom-48">
              {photos.slice(-8).map((p) => (
                <div
                  key={p.id}
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded border-2 border-white/60"
                >
                  <img src={p.thumbDataUrl} alt="" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 right-0 bg-black/70 px-1 py-px text-[8px] tabular-nums leading-none">
                    {fmtTime(p.offsetSeconds)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Live VU meter + transcript preview */}
          {phase === "recording" && (
            <div className="pointer-events-none absolute inset-x-3 bottom-28 flex flex-col items-stretch gap-2 sm:bottom-32 landscape:bottom-24">
              <VUMeter level={micLevel} active={micLive} />
              <div className="min-h-[72px] max-h-[140px] overflow-y-auto rounded-xl border border-white/10 bg-black/65 px-3 py-2 text-sm leading-snug text-white backdrop-blur-sm">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  Live transcript
                </p>
                {liveCommitted || livePartial ? (
                  <p>
                    <span>{liveCommitted}</span>
                    {livePartial && <span className="text-white/60"> {livePartial}</span>}
                  </p>
                ) : postRecordTranscriptionOnly ? (
                  <p className="italic text-white/50">Recording narration for the final report…</p>
                ) : (
                  <p className="italic text-white/50">
                    Listening… speak naturally and we'll transcribe in real time.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Bottom controls */}
          {phase === "recording" && (
            <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 bg-gradient-to-t from-black/85 to-transparent p-4 pt-12">
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                  className={`flex h-12 w-12 items-center justify-center rounded-full border border-white/30 backdrop-blur-sm transition active:scale-95 ${muted ? "bg-red-600 text-white" : "bg-black/50 text-white hover:bg-black/70"}`}
                >
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <span className="text-[10px] font-medium text-white/70">
                  {muted ? "Muted" : "Mic"}
                </span>
              </div>
              <button
                onClick={capturePhoto}
                disabled={capturing}
                aria-label="Capture photo"
                className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-white/10 ring-4 ring-black/40 transition active:scale-95 disabled:opacity-50"
              >
                {capturing ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <span className="h-12 w-12 rounded-full bg-white" />
                )}
              </button>
              <div className="flex items-end gap-2">
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={toggleSelfView}
                    aria-label={selfActive ? "Turn off self view" : "Turn on self view"}
                    className={`flex h-12 w-12 items-center justify-center rounded-full border border-white/30 backdrop-blur-sm transition active:scale-95 ${selfActive ? "bg-primary text-primary-foreground" : "bg-black/50 text-white hover:bg-black/70"}`}
                  >
                    <PictureInPicture2 className="h-5 w-5" />
                  </button>
                  <span className="text-[10px] font-medium text-white/70">Self</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={flipCamera}
                    disabled={flipping}
                    aria-label="Flip camera"
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white backdrop-blur-sm transition hover:bg-black/70 active:scale-95 disabled:opacity-50"
                  >
                    {flipping ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <SwitchCamera className="h-5 w-5" />
                    )}
                  </button>
                  <span className="text-[10px] font-medium text-white/70">Flip</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={finish}
                    aria-label="Stop walkthrough"
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white ring-4 ring-white/30 transition active:scale-95"
                  >
                    <Square className="h-5 w-5 fill-white" />
                  </button>
                  <span className="text-[10px] font-medium text-white/70">Stop</span>
                </div>
              </div>
            </div>
          )}

          {phase === "finishing" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-white">
              {finishError ? (
                <>
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-red-500/15 text-red-300">
                    <X className="h-6 w-6" />
                  </div>
                  <p className="text-base font-semibold">Something went wrong</p>
                  <p className="max-w-sm text-center text-sm text-white/70">{finishError}</p>
                  <div className="mt-1 flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="bg-white/10 text-white hover:bg-white/20"
                      onClick={() => {
                        setFinishError(null);
                        setPhase("recording");
                      }}
                    >
                      Keep recording
                    </Button>
                    <Button
                      size="sm"
                      className="bg-white text-black hover:bg-white/90"
                      onClick={onClose}
                    >
                      Close
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Sparkles className="h-10 w-10 animate-pulse text-primary" />
                  <p className="text-base font-semibold">Creating your report…</p>
                  <p className="max-w-sm text-center text-sm text-white/60">
                    This usually takes under a minute. You can leave this screen — we'll keep
                    working in the background and your report will be waiting for you.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 bg-white/10 text-white hover:bg-white/20"
                    onClick={() => (onContinueInBackground ?? onClose)()}
                  >
                    Continue in background
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VUMeter({ level, active }: { level: number; active: boolean }) {
  // Horizontal multi-segment VU meter. Bars light up as voice level rises.
  const bars = 24;
  return (
    <div className="flex h-6 items-center gap-[3px] rounded-full bg-black/55 px-3 py-1 backdrop-blur-sm">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars;
        const isActive = active && level >= threshold - 0.06;
        // Color ramp: green → amber → red toward the right.
        const color = !isActive
          ? "bg-white/15"
          : i < bars * 0.6
            ? "bg-emerald-400"
            : i < bars * 0.85
              ? "bg-amber-400"
              : "bg-red-500";
        // Center-weighted height for a classic VU look.
        const dist = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
        const h = 6 + Math.round((1 - dist) * 10);
        return (
          <span
            key={i}
            className={`w-[3px] rounded-sm transition-colors duration-75 ${color}`}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}
