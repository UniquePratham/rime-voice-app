"use client";

/**
 * Spech recognition wrapper around the Web Speech API.
 * Provides interim results, final transcripts, input-level callbacks and
 * explicit start/stop so the voice runtime can treat listening as a
 * first-class, interruptible state.
 */

export type SpeechRecogApis = {
  new (): SpeechRecognitionLike;
};

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  start: () => void;
  abort: () => void;
  stop: () => void;
}

export interface SpeechRecognitionResultLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionAlternativeLike & { isFinal: boolean }>;
}

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SttCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onAudioLevel: (level: number) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

export function detectSpeechRecognition(): SpeechRecogApis | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecogApis;
    webkitSpeechRecognition?: SpeechRecogApis;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function createLevelMonitor(): {
  start: () => void;
  stop: () => void;
  setCallback: (cb: (level: number) => void) => void;
} {
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let raf = 0;
  let cb: (level: number) => void = () => {};
  let stream: MediaStream | null = null;

  async function start() {
    if (!window.AudioContext) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (!analyser) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        cb(Math.min(1, rms * 6));
        raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      /* mic not permitted — level stays 0 */
    }
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    analyser = null;
    if (ctx) void ctx.close().catch(() => {});
    ctx = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  return {
    start,
    stop,
    setCallback: (fn) => {
      cb = fn;
    },
  };
}

export class SttSession {
  private rec: SpeechRecognitionLike;
  private started = false;

  constructor(private cbs: SttCallbacks) {
    const Ctor = detectSpeechRecognition();
    if (!Ctor) {
      throw new Error("Speech recognition unsupported in this browser");
    }
    this.rec = new Ctor();
    this.rec.lang = "en-US";
    this.rec.continuous = false;
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 1;

    this.rec.onstart = () => {};
    this.rec.onend = () => {
      this.started = false;
      this.cbs.onEnd();
    };
    let lastLevel = 0;
    this.rec.onaudiostart = () => {
      this.cbs.onAudioLevel(0.05);
      lastLevel = 0;
    };
    this.rec.onaudioend = () => {
      this.cbs.onAudioLevel(0);
    };
    this.rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        const transcript = r.transcript;
        if (r.isFinal) final += transcript;
        else interim += transcript;
      }
      lastLevel = Math.min(1, lastLevel + 0.15);
      this.cbs.onAudioLevel(lastLevel);
      if (final) this.cbs.onFinal(final);
      else if (interim) this.cbs.onInterim(interim);
    };
    this.rec.onerror = () => {
      this.cbs.onError("recognition error");
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.rec.start();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.rec.stop();
  }

  abort() {
    this.started = false;
    try {
      this.rec.abort();
    } catch {
      /* noop */
    }
  }
}