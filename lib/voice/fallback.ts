"use client";

import type { PlaybackHandles, VoiceEngine } from "@/lib/voice/engine";
import type { ProviderRecord, Utterance, VoiceConfig } from "@/lib/types";

/**
 * OptionalFallbackVoiceEngine.
 *
 * Activation is always explicit and observable: the runtime marks
 * `usedFallback: true` and the UI shows a "FALLBACK" badge whenever audio was
 * not produced by Rime. This engine exists only for resilience and is never
 * the default judged path.
 */

const FALLBACK_CONFIG: VoiceConfig = {
  provider: "fallback",
  model: "locale",
  voice: "default",
  language: "en-US",
  endpoint: "browser-speech-synthesis",
  audioFormat: "n/a",
  transport: "local",
};

export class OptionalFallbackVoiceEngine implements VoiceEngine {
  readonly name = "OptionalFallbackVoiceEngine";
  readonly config: VoiceConfig = FALLBACK_CONFIG;

  private lastRecord: ProviderRecord | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        this.voice =
          voices.find((v) => v.lang.startsWith("en") && /female|woman|Samantha|Zira|Jenny/i.test(v.name)) ??
          voices.find((v) => v.lang.startsWith("en")) ??
          null;
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }

  synthesize(utterance: Utterance): Promise<PlaybackHandles> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(utterance.text);
      u.voice = this.voice;
      u.rate = 1;
      u.pitch = 1;
      const startedAt = Date.now();
      this.currentUtterance = u;

      const finished = new Promise<void>((resolveDone) => {
        u.onend = () => {
          this.lastRecord = this.compose(true, Date.now() - startedAt);
          resolveDone();
        };
        u.onerror = () => {
          this.lastRecord = this.compose(true, Date.now() - startedAt, true);
          resolveDone();
        };
      });

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      resolve({
        stop: () => {
          try {
            window.speechSynthesis.cancel();
          } catch {
            /* noop */
          }
          this.lastRecord = this.compose(false, Date.now() - startedAt);
        },
        finished,
      });
    });
  }

  private compose(playedToEnd: boolean, durationMs: number, errored = false): ProviderRecord {
    return {
      provider: FALLBACK_CONFIG.provider,
      model: FALLBACK_CONFIG.model,
      voice: this.voice?.name ?? FALLBACK_CONFIG.voice,
      language: this.voice?.lang ?? FALLBACK_CONFIG.language,
      endpoint: FALLBACK_CONFIG.endpoint,
      audioFormat: FALLBACK_CONFIG.audioFormat,
      transport: FALLBACK_CONFIG.transport,
      playbackTimingMs: durationMs,
      interrupted: !playedToEnd,
      usedFallback: true,
      synthesisTimingMs: errored ? undefined : durationMs,
    };
  }

  async stopAll(): Promise<void> {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  providerRecord(): ProviderRecord {
    return (
      this.lastRecord ??
      this.compose(true, 0)
    );
  }

  get available(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }
}