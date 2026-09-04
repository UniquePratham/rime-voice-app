"use client";

import type {
  PlaybackHandles,
  VoiceEngine,
} from "@/lib/voice/engine";
import { base64ToBytes } from "@/lib/voice/engine";
import type { ProviderRecord, RimeSynthesisTimings, Utterance, VoiceConfig } from "@/lib/types";

/**
 * RimePrimaryVoiceEngine.
 *
 * All synthesis requests go through the server-side proxy (/api/rime-tts) so
 * the RIME_API_KEY never touches the browser. Audio is decoded with WebAudio
 * and played through a single AudioContext source so interruption is a hard
 * stop on the source node — measured to millisecond resolution.
 */

const RIME_CONFIG: VoiceConfig = {
  provider: "rime",
  model: "mistv2",
  voice: "astra",
  language: "en-US",
  endpoint: "https://users.rime.ai/v1/rime-tts",
  audioFormat: "wav",
  transport: "http-tts (server proxy)",
};

export class RimePrimaryVoiceEngine implements VoiceEngine {
  readonly name = "RimePrimaryVoiceEngine";
  readonly config: VoiceConfig = RIME_CONFIG;

  private ctx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private stopped = new Set<number>();
  private gidCounter = 0;
  private lastProviderRecord: ProviderRecord | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private nextGid(): number {
    this.gidCounter += 1;
    return this.gidCounter;
  }

  async synthesize(utterance: Utterance): Promise<PlaybackHandles> {
    const ctx = this.ensureCtx();
    const gid = this.nextGid();
    const timings: RimeSynthesisTimings = {
      requestSentAt: Date.now(),
      chunks: 0,
      totalBytes: 0,
    };

    const res = await fetch("/api/rime-tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: utterance.text,
        speaker: RIME_CONFIG.voice,
        modelId: RIME_CONFIG.model,
        samplingRate: 24000,
        speed: 1,
      }),
    });
    timings.requestReceiptAt = Date.now();

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`rime-tts ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      audioBase64?: string;
      format?: string;
      durationMs?: number;
      provider?: string;
    };
    if (!json.audioBase64) throw new Error("rime-tts returned no audio");

    const bytes = base64ToBytes(json.audioBase64);
    timings.chunks = 1;
    timings.totalBytes = bytes.byteLength;
    timings.synthDurationMs = json.durationMs;

    const audioBuffer = await ctx.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    timings.playbackStartedAt = Date.now();

    if (this.stopped.has(gid)) {
      // Already fenced during decode — do not play.
      timings.playbackEndedAt = Date.now();
      this.lastProviderRecord = this.composeRecord(timings, true);
      await Promise.resolve();
      return {
        stop: () => {},
        finished: Promise.resolve(),
      };
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    this.activeSource = source;

    const finished = new Promise<void>((resolve) => {
      source.onended = () => {
        this.activeSource = null;
        timings.playbackEndedAt = Date.now();
        this.lastProviderRecord = this.composeRecord(timings, false);
        resolve();
      };
    });

    source.start();

    return {
      stop: () => {
        const interruptedAt = Date.now();
        this.stopped.add(gid);
        if (this.activeSource) {
          try {
            this.activeSource.stop();
          } catch {
            /* already stopped */
          }
          this.activeSource = null;
        }
        timings.playbackEndedAt = Date.now();
        timings.playbackStartedAt = timings.playbackStartedAt ?? interruptedAt;
        this.lastProviderRecord = this.composeRecord(timings, true);
      },
      finished,
    };
  }

  private composeRecord(timings: RimeSynthesisTimings, interrupted: boolean): ProviderRecord {
    return {
      provider: RIME_CONFIG.provider,
      model: RIME_CONFIG.model,
      voice: RIME_CONFIG.voice,
      language: RIME_CONFIG.language,
      endpoint: RIME_CONFIG.endpoint,
      audioFormat: RIME_CONFIG.audioFormat,
      transport: RIME_CONFIG.transport,
      requestTimingMs: timings.requestReceiptAt
        ? timings.requestReceiptAt - timings.requestSentAt
        : undefined,
      synthesisTimingMs: timings.synthDurationMs,
      playbackTimingMs: timings.playbackEndedAt && timings.playbackStartedAt
        ? timings.playbackEndedAt - timings.playbackStartedAt
        : undefined,
      interruptionAt: interrupted ? timings.playbackEndedAt : undefined,
      interrupted,
      usedFallback: false,
    };
  }

  async stopAll(): Promise<void> {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        /* noop */
      }
      this.activeSource = null;
    }
  }

  providerRecord(): ProviderRecord {
    return (
      this.lastProviderRecord ?? {
        provider: RIME_CONFIG.provider,
        model: RIME_CONFIG.model,
        voice: RIME_CONFIG.voice,
        language: RIME_CONFIG.language,
        endpoint: RIME_CONFIG.endpoint,
        audioFormat: RIME_CONFIG.audioFormat,
        transport: RIME_CONFIG.transport,
        interrupted: false,
        usedFallback: false,
      }
    );
  }
}