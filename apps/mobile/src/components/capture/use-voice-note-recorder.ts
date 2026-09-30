import { useEffect, useRef, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { transcribeVoiceNote } from "@/api/voice-note";
import {
  VOICE_NOTE_MAX_SECONDS,
  transcriptionFailure,
  type VoiceNoteFallback,
} from "@/lib/voice-note";

/**
 * AAC in an .m4a, as the high quality preset records it, but mono and at
 * speech bitrate: a two minute note is about a megabyte to upload rather than
 * two, and a voice loses nothing.
 */
const VOICE_PRESET = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64000 };

export type VoiceNotePhase = "idle" | "starting" | "recording" | "transcribing";

/**
 * The note editor's recorder: tap to record, Stop to transcribe.
 *
 * `onText` gets the words; `onFallback` gets why the keyboard has to take
 * over instead (see `lib/voice-note.ts`). Both are read through refs when the
 * answer arrives, so a transcription still lands when the editor was closed
 * while it ran: the words go to the photo through the latest callbacks.
 *
 * The audio session is only switched to recording while recording, and put
 * back after, so the camera and anything that plays sound are left as they
 * were.
 */
export function useVoiceNoteRecorder({
  onText,
  onFallback,
}: {
  onText: (text: string) => void;
  onFallback: (reason: VoiceNoteFallback) => void;
}) {
  const recorder = useAudioRecorder(VOICE_PRESET);
  const status = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState<VoiceNotePhase>("idle");
  const phaseRef = useRef<VoiceNotePhase>("idle");
  const mounted = useRef(true);
  const pending = useRef<Promise<void> | null>(null);
  const callbacks = useRef({ onText, onFallback });
  callbacks.current = { onText, onFallback };

  function move(next: VoiceNotePhase) {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closed mid-recording without Stop: nothing is kept, and the session
      // goes back to playback only.
      if (phaseRef.current === "recording" || phaseRef.current === "starting") {
        phaseRef.current = "idle";
        try {
          void recorder.stop().catch(() => undefined);
        } catch {
          // Already released with the editor.
        }
        void releaseAudio();
      }
    };
  }, [recorder]);

  async function start() {
    if (phaseRef.current !== "idle") return;
    move("starting");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        move("idle");
        callbacks.current.onFallback("permission");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      // Closed while the permission prompt was up.
      if ((phaseRef.current as VoiceNotePhase) !== "starting") return;
      recorder.record();
      move("recording");
    } catch {
      void releaseAudio();
      move("idle");
      callbacks.current.onFallback("failed");
    }
  }

  /**
   * Stop recording and send the clip. Resolves once the file is written, so a
   * caller closing the editor can wait for that; the transcription carries on
   * after.
   */
  async function stop() {
    if (phaseRef.current !== "recording") return;
    move("transcribing");
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      uri = null;
    }
    void releaseAudio();
    const run = transcribe(uri);
    pending.current = run;
    void run.finally(() => {
      if (pending.current === run) pending.current = null;
    });
  }

  /** Resolves once the words from the last Stop have been handed over. */
  function settled(): Promise<void> {
    return pending.current ?? Promise.resolve();
  }

  async function transcribe(uri: string | null) {
    try {
      if (!uri) {
        callbacks.current.onFallback("failed");
        return;
      }
      const text = await transcribeVoiceNote(uri);
      if (text) callbacks.current.onText(text);
      else callbacks.current.onFallback("silent");
    } catch (e) {
      callbacks.current.onFallback(transcriptionFailure(e));
    } finally {
      move("idle");
    }
  }

  const elapsedMs = phase === "recording" ? status.durationMillis : 0;

  /* The longest note the API takes: stop there rather than lose the lot. */
  useEffect(() => {
    if (phase === "recording" && elapsedMs >= VOICE_NOTE_MAX_SECONDS * 1000) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, elapsedMs]);

  return { phase, elapsedMs, start, stop, settled };
}

async function releaseAudio() {
  try {
    await setAudioModeAsync({ allowsRecording: false });
  } catch {
    // Nothing to put back.
  }
}
