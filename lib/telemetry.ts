import type { InterruptionSample, TelemetrySample } from "@/lib/types";

/**
 * Lightweight, dependency-free telemetry sink.
 * Records every instrumented point so the evaluation panel and the evidence
 * file can report measured behavior rather than invented numbers.
 */

class Telemetry {
  private samples: TelemetrySample[] = [];
  private interruptions: InterruptionSample[] = [];
  private listeners = new Set<(samples: TelemetrySample[]) => void>();

  record(sample: Omit<TelemetrySample, "at"> & { at?: number }) {
    const s: TelemetrySample = { ...sample, at: sample.at ?? Date.now() } as TelemetrySample;
    this.samples.push(s);
    for (const l of this.listeners) l(this.samples);
    return s;
  }

  recordInterruption(sample: InterruptionSample) {
    this.interruptions.push(sample);
    for (const l of this.listeners) l(this.samples);
    return sample;
  }

  lateUpdateInterruption(at: number, patch: Partial<InterruptionSample>) {
    const idx = this.interruptions.findIndex((i) => i.at === at);
    if (idx === -1) return;
    this.interruptions[idx] = { ...this.interruptions[idx], ...patch };
    for (const l of this.listeners) l(this.samples);
  }

  reset() {
    this.samples = [];
    this.interruptions = [];
    for (const l of this.listeners) l(this.samples);
  }

  get all(): TelemetrySample[] {
    return [...this.samples];
  }

  /** Latest sample for a given metric name reachable from a tag filter. */
  latest(name: string, tags?: Record<string, string | number | boolean>) {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.name !== name) continue;
      if (tags && s.tags) {
        const ok = Object.entries(tags).every(([k, v]) => s.tags![k] === v);
        if (!ok) continue;
      }
      return s;
    }
    return undefined;
  }

  byName(name: string) {
    return this.samples.filter((s) => s.name === name);
  }

  summary() {
    const untilAudioStop = this.interruptions.map((i) => i.audioStopLatencyMs);
    const toListening = this.interruptions.map((i) => i.speechToListeningMs);
    const suppressCount = this.interruptions.filter((i) => i.staleSuppressed).length;
    const recoveryOk = this.interruptions.filter((i) => i.recoveryOk).length;

    const avg = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

    return {
      interruptions: this.interruptions.length,
      audioStopLatencyMs: { avg: avg(untilAudioStop), raw: untilAudioStop },
      speechToListeningMs: { avg: avg(toListening), raw: toListening },
      staleSuppressed: suppressCount,
      staleSuppressedRate: this.interruptions.length
        ? Math.round((suppressCount / this.interruptions.length) * 1000) / 10
        : null,
      recoveryOk,
      recoveryOkRate: this.interruptions.length
        ? Math.round((recoveryOk / this.interruptions.length) * 1000) / 10
        : null,
      samples: this.samples.length,
    };
  }
}

export const telemetry = new Telemetry();

export function ms(a: number, b: number) {
  return Math.max(0, b - a);
}