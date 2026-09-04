import type {
  ProviderRecord,
  RimeSynthesisTimings,
  SpeechSession,
  Utterance,
  VoiceEngine,
  PlaybackHandles,
} from "@/lib/types";

/**
 * VoiceEngine — explicit voice runtime abstraction.
 *
 * The judged path is RimePrimaryVoiceEngine. Any fallback is a separate
 * engine class and its activation is observable via `ProviderRecord`.
 */

export type {
  VoiceEngine,
  PlaybackHandles,
  ProviderRecord,
  RimeSynthesisTimings,
  SpeechSession,
  Utterance,
};

export interface EngineTransport {
  baseUrl: string;
  modelId: string;
  speaker: string;
  language: string;
  audioFormat: string;
  transport: string;
}

export const RIME_METADATA: EngineTransport = {
  baseUrl: "https://rjm-datacenter-usw1.rime.dev/v1/rime-tts",
  modelId: "v2.5",
  speaker: "amara",
  language: "en-US",
  audioFormat: "wav",
  transport: "http-tts",
};

export function createSessionId(turnId: string, generationId: string): string {
  return `${turnId}:${generationId}`;
}

export class SpeechBuffer {
  private data = new Uint8Array(0);

  append(chunk: Uint8Array) {
    const next = new Uint8Array(this.data.length + chunk.length);
    next.set(this.data);
    next.set(chunk, this.data.length);
    this.data = next;
  }

  get bytes(): Uint8Array {
    return this.data;
  }

  get byteLength(): number {
    return this.data.length;
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface PlaybackMeasurements {
  timings: RimeSynthesisTimings;
  interruptedAt?: number;
  playbackEndedAt?: number;
}

export function trackSession(session: SpeechSession): SpeechSession {
  return session;
}