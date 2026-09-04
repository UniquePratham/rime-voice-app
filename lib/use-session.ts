"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationRuntime } from "@/lib/conversation";
import { RimePrimaryVoiceEngine } from "@/lib/voice/rime";
import { OptionalFallbackVoiceEngine } from "@/lib/voice/fallback";
import { createLevelMonitor } from "@/lib/stt";
import type { Program, ProviderRecord } from "@/lib/types";
import { telemetry } from "@/lib/telemetry";

export interface TranscriptLine {
  id: string;
  role: "you" | "coach";
  text: string;
  time: number;
  fence?: boolean;
  interim?: boolean;
}

export interface SessionVm {
  phase: string;
  transcript: TranscriptLine[];
  interim: string;
  level: number;
  program: Program;
  provider: ProviderRecord;
  supportingTool: string;
  holding: boolean;
  micError: string;
}

const STORAGE_KEYS = {
  delay: "spotter.simulatedDelayMs",
  fallback: "spotter.fallback",
};

export function useSession() {
  const [vm, setVm] = useState<SessionVm>(() => ({
    phase: "IDLE",
    transcript: [],
    interim: "",
    level: 0,
    program: defaultProgramVm(),
    provider: placeholderProvider(),
    supportingTool: "none",
    holding: false,
    micError: "",
  }));

  const patch = useCallback((fn: (p: SessionVm) => SessionVm) => {
    setVm(fn);
  }, []);

  const vmRef = useRef(vm);
  vmRef.current = vm;

  const runtimeRef = useRef<ConversationRuntime | null>(null);
  if (!runtimeRef.current) {
    const delay = readNumber(STORAGE_KEYS.delay, 0);
    const fallback = readBool(STORAGE_KEYS.fallback, false);
    const rime = new RimePrimaryVoiceEngine();
    const fb = new OptionalFallbackVoiceEngine();
    const rt = new ConversationRuntime(rime, fb, {
      simulateDelayMs: delay,
      useAi: true,
    });
    rt.setFallbackEnabled(fallback);
    runtimeRef.current = rt;
  }
  const runtime = runtimeRef.current;

  const sttRef = useRef<ReturnType<typeof makeSttHandle> | null>(null);
  if (!sttRef.current) {
    sttRef.current = makeSttHandle({
      onInterim: (text) => patch((p) => ({ ...p, interim: text, micError: "" })),
      onFinal: () => {},
      onAudioLevel: (level) => patch((p) => ({ ...p, level })),
      onEnd: () => patch((p) => ({ ...p, level: 0 })),
      onError: (message) => patch((p) => ({ ...p, micError: message, level: 0 })),
    });
  }

  useEffect(() => {
    const unsub = runtime.subscribe((e) => {
      if (e.type === "state") {
        patch((p) => ({ ...p, phase: String(e.phase ?? p.phase) }));
        if (e.phase === "THINKING" && e.userText) {
          patch((p) => ({
            ...p,
            transcript: [
              ...p.transcript,
              {
                id: `${e.generationId}-user-${Date.now()}`,
                role: "you",
                text: String(e.userText),
                time: Date.now(),
              },
            ],
            interim: "",
          }));
        }
        if (e.phase === "SPEAKING" && e.text) {
          patch((p) => ({
            ...p,
            transcript: [
              ...p.transcript,
              {
                id: `${e.generationId}-coach-${Date.now()}`,
                role: "coach",
                text: String(e.text),
                time: Date.now(),
              },
            ],
          }));
        }
        if (e.phase === "CANCELLING") {
          patch((p) => fenceLastCoachLine(p));
        }
        if (e.phase === "ERROR" && e.error) {
          patch((p) => ({
            ...p,
            transcript: [
              ...p.transcript,
              {
                id: `err-${Date.now()}`,
                role: "coach",
                text: `Error: ${e.error}. Press reset and try again.`,
                time: Date.now(),
                interim: true,
              },
            ],
          }));
        }
      }
      if (e.type === "telemetry") {
        patch((p) => ({
          ...p,
          program: runtime.programSnapshot,
          provider: runtime.providerRecord,
        }));
      }
    });

    const poll = setInterval(() => {
      patch((p) => ({
        ...p,
        program: runtime.programSnapshot,
        provider: runtime.providerRecord,
      }));
    }, 350);

    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [runtime]);

  const rimeReady = useMemo(
    () => runtime.rimeConfig.model + "@" + runtime.rimeConfig.voice,
    [runtime.rimeConfig.model, runtime.rimeConfig.voice],
  );

  const beginHold = useCallback(() => {
    const stt = sttRef.current!;
    runtime.beginInput();
    // New listening window resets the input level visualization.
    patch((p) => ({ ...p, level: 0.02, interim: "", micError: "" }));
    stt.startListening();
    setHolding(true);
  }, [runtime]);

  const sttStatus = useMemo(() => {
    const handle = sttRef.current;
    return { ok: Boolean(handle?.available), reason: handle?.reason ?? "" };
  }, []);

  const endHold = useCallback(
    async (cancelled = false) => {
      const stt = sttRef.current!;
      await stt.stopListening();
      const text = stt.takeFinal();
      stt.stopLevelMonitor();
      setHolding(false);
      if (cancelled) {
        runtime.fenceActiveTurnPublic();
      } else {
        void runtime.endInput(text);
      }
    },
    [runtime],
  );

  const [holding, setHolding] = useState(false);

  const reset = useCallback(() => {
    sttRef.current?.stopListening();
    sttRef.current?.stopLevelMonitor();
    runtime.reset();
    patch((p) => ({
      ...p,
      phase: "IDLE",
      transcript: [],
      interim: "",
      level: 0,
      program: runtime.programSnapshot,
      provider: runtime.providerRecord,
      supportingTool: "none",
      micError: "",
    }));
  }, [runtime]);

  const setSimulatedDelay = useCallback(
    (ms: number) => {
      runtime.setSimulatedDelay(ms);
      localStorage.setItem(STORAGE_KEYS.delay, String(ms));
      patch((p) => ({ ...p }));
    },
    [runtime, patch],
  );

  const setFallback = useCallback(
    (enabled: boolean) => {
      runtime.setFallbackEnabled(enabled);
      localStorage.setItem(STORAGE_KEYS.fallback, String(enabled));
      patch((p) => ({ ...p, provider: runtime.providerRecord }));
    },
    [runtime, patch],
  );

  const evalData = useMemo(() => {
    const summary = telemetry.summary();
    const latest = telemetry.byName("intent.parsed");
    const intentProvider = latest.length ? latest[latest.length - 1].tags?.provider : ("" as unknown);
    return {
      summary,
      intentProvider: String(intentProvider ?? ""),
      turnId: runtime.debug.turnId,
      generationId: runtime.debug.generationId,
      state: runtime.debug.state,
      provider: runtime.providerRecord.provider,
      model: runtime.providerRecord.model,
      voice: runtime.providerRecord.voice,
      tool: runtime.providerRecord.usedFallback ? "fallback" : runtime.providerRecord.provider,
    };
  }, [vm.phase, vm.transcript.length, rimeReady]);

  const submitText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      runtime.beginInput();
      void runtime.endInput(trimmed);
    },
    [runtime],
  );

  return {
    vm,
    actions: { beginHold, endHold, submitText, reset, setSimulatedDelay, setFallback },
    evalData,
    runtime,
    sttStatus,
    holding,
    rimeReady,
  };
}

function fenceLastCoachLine(p: SessionVm): SessionVm {
  const lines = [...p.transcript];
  const idx = [...lines].map((l) => l.role).lastIndexOf("coach");
  if (idx !== -1) {
    lines[idx] = { ...lines[idx], fence: true };
  }
  return { ...p, transcript: lines };
}

function defaultProgramVm(): Program {
  return {
    sessionId: `session-${Date.now()}`,
    athlete: "Avery",
    name: "Strength Block — W3D2",
    currentBlockIndex: 0,
    blocks: [
      {
        id: "b1",
        name: "Main Lift",
        exercises: [
          { id: "e1", name: "Squat", sets: 5, reps: 3, weightKg: 180, rpe: 8, restSec: 180, completedSets: 1 },
          { id: "e2", name: "Bench Press", sets: 4, reps: 5, weightKg: 100, rpe: 7.5, restSec: 150, completedSets: 0 },
        ],
      },
      {
        id: "b2",
        name: "Volume Accessory",
        exercises: [
          { id: "e3", name: "Deadlift", sets: 5, reps: 3, weightKg: 220, rpe: 8.5, restSec: 210, completedSets: 0, notes: "no straps" },
          { id: "e4", name: "Barbell Row", sets: 4, reps: 8, weightKg: 70, rpe: 7, restSec: 90, completedSets: 0 },
        ],
      },
    ],
  };
}

function placeholderProvider(): ProviderRecord {
  return {
    provider: "rime",
    model: "v2.5",
    voice: "amara",
    language: "en-US",
    endpoint: "https://rjm-datacenter-usw1.rime.dev/v1/rime-tts",
    audioFormat: "wav",
    transport: "http-tts (server proxy)",
    interrupted: false,
    usedFallback: false,
  };
}

function readNumber(key: string, dflt: number): number {
  if (typeof window === "undefined") return dflt;
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

function readBool(key: string, dflt: boolean): boolean {
  if (typeof window === "undefined") return dflt;
  const v = localStorage.getItem(key);
  if (v === null) return dflt;
  return v === "true";
}

interface SttHandle {
  available: boolean;
  reason: string;
  takeFinal: () => string;
  startListening: () => void;
  stopListening: () => Promise<void>;
  startLevelMonitor: () => void;
  stopLevelMonitor: () => void;
}

/** Why speech recognition can't be used right now ("" = fine). */
function recognitionSupportReason(): string {
  if (typeof window === "undefined") return "";
  if (window.isSecureContext === false) return "insecure-context";
  if (!speechRecognitionCtor()) return "unsupported-browser";
  if (!navigator.mediaDevices?.getUserMedia) return "no-media";
  return "";
}

function friendlyMicMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission denied — allow the mic in your browser, then hold and speak again.";
    case "no-speech":
      return "No speech detected — try again.";
    case "audio-capture":
      return "No microphone found on this device.";
    case "network":
      return "Speech service unreachable (network error).";
    case "aborted":
      return "";
    default:
      return "Speech recognition error — try again.";
  }
}

type RecogType = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function speechRecognitionCtor(): { new (): RecogType } | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: { new (): RecogType };
    webkitSpeechRecognition?: { new (): RecogType };
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function makeSttHandle(cbs: {
  onInterim: (t: string) => void;
  onFinal: () => void;
  onAudioLevel: (l: number) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}): SttHandle {
  const reason = recognitionSupportReason();
  const supported = reason === "";
  let rec: {
    start: () => void;
    stop: () => void;
  } | null = null;
  let finals: string[] = [];
  const levelMonitor = createLevelMonitor();
  let stopEndPromise: Promise<void> = Promise.resolve();

  levelMonitor.setCallback(cbs.onAudioLevel);

  function startListening() {
    finals = [];
    levelMonitor.start();
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (ev) => {
      const event = ev as {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      };
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finals.push(res[0].transcript);
        else interim += res[0].transcript;
      }
      if (interim) cbs.onInterim(interim);
      else if (finals.length) cbs.onInterim(finals.join(" "));
      cbs.onAudioLevel(Math.min(1, interim.length ? 0.5 : 0.25));
    };
    stopEndPromise = new Promise<void>((resolve) => {
      const done = () => {
        cbs.onEnd();
        resolve();
      };
      r.onend = done;
      r.onerror = (ev) => {
        const errorCode = String((ev as { error?: string })?.error ?? "unknown");
        const message = friendlyMicMessage(errorCode);
        if (message) cbs.onError(message);
        done();
      };
    });
    rec = {
      start: () => {
        try {
          r.start();
        } catch {
          cbs.onError("Microphone could not start — check browser mic permissions.");
        }
      },
      stop: () => {
        try {
          r.stop();
        } catch {
          /* noop */
        }
      },
    };
    rec.start();
  }

  return {
    get available() {
      return supported;
    },
    get reason() {
      return reason;
    },
    takeFinal() {
      const f = finals.join(" ").trim();
      finals = [];
      return f;
    },
    startListening,
    stopListening: async () => {
      const pending = stopEndPromise;
      rec?.stop();
      rec = null;
      await pending;
    },
    startLevelMonitor() {
      levelMonitor.start();
    },
    stopLevelMonitor() {
      levelMonitor.stop();
    },
  };
}