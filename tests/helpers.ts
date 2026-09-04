import type { PlaybackHandles, VoiceEngine } from "@/lib/voice/engine";
import type { ProviderRecord, Utterance, VoiceConfig } from "@/lib/types";

export interface RecordedUtterance {
  utterance: Utterance;
  stopped: boolean;
  playedToEnd: boolean;
  synthResolution: "immediate" | "held";
  handleStop: () => void;
  resolveSynth: () => void;
  finishPlayback: () => void;
}

/**
 * ControlledEngine — a deterministic stand-in for the voice engines used in
 * tests. It lets the test decide exactly when synthesis resolves and when
 * playback finishes, so the interruption race can be exercised reliably.
 */
export class ControlledEngine implements VoiceEngine {
  readonly name = "ControlledEngine";
  readonly config: VoiceConfig = {
    provider: "rime",
    model: "fake",
    voice: "fake",
    language: "en-US",
    endpoint: "test",
    audioFormat: "wav",
    transport: "test",
  };

  utterances: RecordedUtterance[] = [];
  private active: RecordedUtterance | null = null;

  constructor(public holdSynth: boolean = true) {}

  synthesize(utterance: Utterance): Promise<PlaybackHandles> {
    return new Promise<PlaybackHandles>((resolve) => {
      let resolveSynth: () => void = () => {};
      let finishPlayback: () => void = () => {};
      let stopRec: () => void = () => {};

      const rec: RecordedUtterance = {
        utterance,
        stopped: false,
        playedToEnd: false,
        synthResolution: this.holdSynth ? "held" : "immediate",
        handleStop: () => stopRec(),
        resolveSynth: () => resolveSynth(),
        finishPlayback: () => finishPlayback(),
      };

      const finished = new Promise<void>((res) => {
        finishPlayback = () => {
          if (rec.stopped) return;
          rec.playedToEnd = true;
          res();
        };
        stopRec = () => {
          if (rec.stopped) return;
          rec.stopped = true;
          res();
        };
      });

      const handles: PlaybackHandles = {
        stop: () => stopRec(),
        finished,
      };

      // finishPlayback must be assigned before any external call, so bind it
      // now through the promise box.
      resolveSynth = () => resolve(handles);

      this.utterances.push(rec);
      this.active = rec;

      if (!this.holdSynth) resolveSynth();
    });
  }

  /**
 * Drive all utterances currently held: release synthesis gates and finish
 * playback so the runtime can reach COMPLETED. Any utterance already stopped
 * (fenced) is left as-is.
 */
driveAllToCompletion() {
  for (const u of this.utterances) {
    if (u.stopped || u.playedToEnd) continue;
    u.resolveSynth();
    u.finishPlayback();
  }
}

get last() {
    return this.utterances[this.utterances.length - 1] ?? null;
  }

  /** Release the synthesis gate for the current utterance. */
  resolveCurrentSynth() {
    this.active?.resolveSynth();
  }

  async stopAll() {
    // Hard stop mirroring the real engine: the audio source is killed and the
    // playback promise resolves as "interrupted", never "played to end".
    if (this.active) {
      this.active.handleStop();
      this.active.resolveSynth();
      this.active = null;
    }
  }

  providerRecord(): ProviderRecord {
    return {
      provider: this.config.provider,
      model: this.config.model,
      voice: this.config.voice,
      language: this.config.language,
      endpoint: this.config.endpoint,
      audioFormat: this.config.audioFormat,
      transport: this.config.transport,
      interrupted: false,
      usedFallback: false,
    };
  }
}

export class InstantEngine extends ControlledEngine {
  constructor() {
    super(false);
  }
}

/** Wait until a predicate is satisfied (with budget). */
export function waitUntil(
  predicate: () => boolean,
  budgetMs = 3000,
  label = "condition",
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > budgetMs) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}