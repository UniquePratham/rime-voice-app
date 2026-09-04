"use client";

import type {
  EngineEvent,
  InterruptionSample,
  Program,
  TurnContext,
  VoiceEngine,
} from "@/lib/types";
import { applyIntent, defaultProgram } from "@/lib/tools";
import { parseIntent } from "@/lib/intent";
import { telemetry, ms } from "@/lib/telemetry";

/**
 * ConversationRuntime — the realtime voice pipeline orchestrator.
 *
 *   STT input → intent parse → tool execution → Rime TTS → playback
 *
 * The hard voice problem is INTERRUPTION + RECOVERY under a double race:
 * the user interrupts while the agent is still speaking AND while a tool call
 * is in flight. Both paths funnel through the same stale-fence: when an
 * input is detected while an earlier turn is active, the active turn is
 * marked stale, its playback is stopped immediately, and any tool result or
 * audio that still resolves afterwards is fenced (never spoken). The final
 * spoken output is always the response to the latest valid turn.
 *
 * Every turn carries a unique turn ID + generation ID; stale work carries a
 * cancelled generation token. Measurements are recorded via telemetry and
 * surfaced in the evaluation panel + RIME_EVIDENCE.md.
 */

export interface RuntimeOptions {
  rimeModelId?: string;
  speaker?: string;
  simulateDelayMs?: number;
  useAi?: boolean;
}

export interface RuntimeDebug {
  turnId: string;
  generationId: string;
  state: string;
  provider: string;
}

type Phase = "IDLE" | "LISTENING" | "THINKING" | "TOOL_RUNNING" | "SPEAKING" | "INTERRUPTING" | "RECOVERING" | "COMPLETED" | "ERROR" | "CANCELLING";

export class ConversationRuntime {
  private program: Program = defaultProgram(`session-${Date.now()}`);
  private turnSeq = 0;
  private genSeq = 0;

  private phase: Phase = "IDLE";
  private currentTurn: TurnContext | null = null;
  private stale = false;
  private cancelToken: symbol | null = null;

  private rime: VoiceEngine;
  private fallback: VoiceEngine;
  private activeIsFallback = false;

  private delayMs: number;
  private useAi: boolean;

  private listeners = new Set<(e: EngineEvent) => void>();
  private recentMessages: { role: "user" | "assistant"; text: string }[] = [];
  private speechStartedAt: number | null = null;
  private pendingInterruption: InterruptionSample | null = null;

  constructor(rime: VoiceEngine, fallback: VoiceEngine, opts: RuntimeOptions = {}) {
    this.rime = rime;
    this.fallback = fallback;
    this.delayMs = opts.simulateDelayMs ?? 0;
    this.useAi = opts.useAi ?? true;
    this.notify({ type: "state", at: Date.now(), phase: "IDLE" });
  }

  on(listener: (e: EngineEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribe(listener: (e: EngineEvent) => void): () => void {
    return this.on(listener);
  }

  get debug(): RuntimeDebug {
    return {
      turnId: `t-${this.turnSeq}`,
      generationId: `g-${this.genSeq}`,
      state: this.phase,
      provider: this.activeIsFallback ? "fallback" : this.rime.config.provider,
    };
  }

  get programSnapshot() {
    return structuredClone(this.program);
  }

  get isSpeaking() {
    return this.phase === "SPEAKING";
  }

  get activePhase() {
    return this.phase;
  }

  get rimeConfig() {
    return this.rime.config;
  }

  get providerRecord() {
    return this.activeIsFallback ? this.fallback.providerRecord() : this.rime.providerRecord();
  }

  /**
   * Handle "user started talking / tapped mic".
   * This is the acknowledged barge-in point: any in-flight turn is fenced.
   */
  /** Handle "user started talking / tapped mic". */
  beginInput() {
    const wasActiveWork =
      this.phase === "SPEAKING" || this.phase === "THINKING" || this.phase === "TOOL_RUNNING";
    if (wasActiveWork) {
      this.fenceActiveTurn("input-start");
      this.recordInterruption(Date.now());
    }
    this.phase = "LISTENING";
    this.notify({ type: "state", at: Date.now(), phase: "LISTENING" });
  }

  /** Continuous-STT barge-in: the user spoke over the agent. */
  bargeIn(partialText: string) {
    const at = Date.now();
    if (this.phase === "SPEAKING" && this.speechStartedAt != null) {
      this.beginInput();
      this.recordInterruption(at, partialText);
    }
    telemetry.record({ name: "barge_in.detected", at, tags: { partial: partialText.slice(0, 40) } });
  }

  /**
   * Final transcript produced by STT — becomes a new authoritative turn.
   */
  async endInput(fullTranscript: string) {
    this.fenceActiveTurn("new-turn");
    this.phase = "THINKING";

    if (!fullTranscript.trim()) {
      this.recover("I didn't catch that. Try again, or say — what is next?");
      return;
    }

    this.turnSeq += 1;
    this.genSeq += 1;
    const turnId = `t-${this.turnSeq}`;
    const generationId = `g-${this.genSeq}`;

    this.stale = false;
    this.cancelToken = Symbol(`gen-${generationId}`);
    this.currentTurn = {
      turnId,
      generationId,
      createdAt: Date.now(),
      userText: fullTranscript,
    };
    this.recentMessages.push({ role: "user", text: fullTranscript });

    this.notify({
      type: "state",
      at: Date.now(),
      phase: "THINKING",
      turnId,
      generationId,
      userText: fullTranscript,
    });

    await this.processTurn(this.currentTurn);
  }

  private fenceActiveTurn(reason: string) {
    if (!this.currentTurn || this.stale) return;
    this.stale = true;
    this.phase = "INTERRUPTING";
    this.notify({
      type: "state",
      at: Date.now(),
      phase: "INTERRUPTING",
      turnId: this.currentTurn.turnId,
      generationId: this.currentTurn.generationId,
      reason,
    });
    telemetry.record({
      name: "turn.fenced",
      at: Date.now(),
      turnId: this.currentTurn.turnId,
      generationId: this.currentTurn.generationId,
      tags: { reason },
    });
    this.stopPlaybackHard();
  }

  private stopPlaybackHard() {
    void this.rime.stopAll();
    void this.fallback.stopAll();
  }

  private recordInterruption(at: number, partial?: string) {
    const sample: InterruptionSample = {
      at,
      speechStartedAt: this.speechStartedAt ?? at,
      audioStoppedAt: Date.now(),
      listeningAt: Date.now(),
      audioStopLatencyMs: ms(this.speechStartedAt ?? at, Date.now()),
      speechToListeningMs: 0,
      staleSuppressed: this.stale,
      recoveryOk: false,
      finalTurnId: this.currentTurn?.turnId ?? "t-0",
      partial,
    };
    this.pendingInterruption = sample;
    telemetry.record({ name: "interrupt.issued", at, turnId: this.currentTurn?.turnId });
    telemetry.recordInterruption(sample);
  }

  private closeInterruption(recovered: boolean) {
    if (this.pendingInterruption) {
      telemetry.lateUpdateInterruption(this.pendingInterruption.at, {
        recoveryOk: recovered,
        finalTurnId: this.currentTurn?.turnId ?? "t-0",
      });
      this.pendingInterruption = null;
    }
  }

  private async processTurn(turn: TurnContext) {
    const token = this.cancelToken;
    try {
      const intentStartAt = Date.now();

      // 1) understand (AI when configured, deterministic local otherwise)
      let outcome;
      try {
        outcome = await parseIntent(turn.userText ?? "", this.useAi);
      } catch {
        outcome = { provider: "local" as const, intent: undefined };
      }

      if (this.isSuperseded(token, turn)) {
        this.notify({ type: "state", at: Date.now(), phase: "CANCELLING", reason: "stale-intent" });
        return;
      }
      turn.intent = outcome.intent;
      telemetry.record({
        name: "intent.parsed",
        at: Date.now(),
        turnId: turn.turnId,
        generationId: turn.generationId,
        durationMs: ms(intentStartAt, Date.now()),
        tags: { provider: outcome.provider, type: outcome.intent?.type ?? "none" },
      });

      // 2) tool execution (deterministic program engine + optional delay)
      this.phase = "TOOL_RUNNING";
      this.notify({ type: "state", at: Date.now(), phase: "TOOL_RUNNING", turnId: turn.turnId, generationId: turn.generationId });

      const toolStart = Date.now();
      if (this.delayMs > 0) await sleep(this.delayMs);

      if (this.isSuperseded(token, turn)) {
        // STALE TOOL RESULT — fenced at the state level, never spoken.
        telemetry.record({
          name: "stale.result.rejected",
          at: Date.now(),
          turnId: turn.turnId,
          generationId: turn.generationId,
          tags: { reason: "superseded-before-delivery" },
        });
        this.notify({ type: "state", at: Date.now(), phase: "CANCELLING", reason: "stale-tool-result" });
        return;
      }

      const { program: nextProgram, change } = applyIntent(this.program, outcome.intent ?? { type: "help", raw: turn.userText ?? "" });
      turn.toolName = outcome.intent?.type;
      turn.toolStartedAt = toolStart;
      turn.toolFinishedAt = Date.now();
      telemetry.record({
        name: "tool.executed",
        at: Date.now(),
        turnId: turn.turnId,
        generationId: turn.generationId,
        durationMs: turn.toolFinishedAt - toolStart,
        tags: { tool: turn.toolName ?? "none" },
      });

      if (this.isSuperseded(token, turn)) {
        telemetry.record({
          name: "stale.result.rejected",
          at: Date.now(),
          turnId: turn.turnId,
          generationId: turn.generationId,
          tags: { reason: "superseded-after-tool" },
        });
        this.notify({ type: "state", at: Date.now(), phase: "CANCELLING", reason: "stale-tool-result" });
        return;
      }

      this.program = nextProgram;
      const speak = change;
      this.recentMessages.push({ role: "assistant", text: speak });
      turn.lastSpoken = speak;

      // 3) Rime synthesis
      this.speechStartedAt = Date.now();
      this.phase = "SPEAKING";
      this.notify({
        type: "state",
        at: Date.now(),
        phase: "SPEAKING",
        turnId: turn.turnId,
        generationId: turn.generationId,
        text: speak,
      });
      this.notify({ type: "speech", at: Date.now(), kind: "start", text: speak });

      const utterance = { turnId: turn.turnId, generationId: turn.generationId, text: speak, preparedAt: Date.now() };
      const engine = this.activeIsFallback ? this.fallback : this.rime;

      telemetry.record({
        name: "closure.started",
        at: Date.now(),
        turnId: turn.turnId,
        generationId: turn.generationId,
        durationMs: ms(turn.createdAt, Date.now()),
      });

      try {
        const handles = await engine.synthesize(utterance);
        telemetry.record({
          name: "synth.sent",
          at: Date.now(),
          turnId: turn.turnId,
          generationId: turn.generationId,
          durationMs: ms(utterance.preparedAt, Date.now()),
          tags: { provider: engine.config.provider },
        });

        if (this.isSuperseded(token, turn)) {
          handles.stop();
          telemetry.record({
            name: "speech.fenced",
            at: Date.now(),
            turnId: turn.turnId,
            generationId: turn.generationId,
            tags: { reason: "superseded-during-synth" },
          });
          return;
        }

        await handles.finished;
        if (this.isSuperseded(token, turn)) return;

        this.phase = "COMPLETED";
        this.closeInterruption(true);
        this.notify({
          type: "state",
          at: Date.now(),
          phase: "COMPLETED",
          turnId: turn.turnId,
          generationId: turn.generationId,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "synthesis failed";
        telemetry.record({
          name: "synth.failed",
          at: Date.now(),
          turnId: turn.turnId,
          generationId: turn.generationId,
          tags: { error: message.slice(0, 120) },
        });
        this.phase = "ERROR";
        this.notify({ type: "state", at: Date.now(), phase: "ERROR", error: message });
      }
    } catch (err) {
      this.phase = "ERROR";
      this.notify({
        type: "state",
        at: Date.now(),
        phase: "ERROR",
        error: err instanceof Error ? err.message : "runtime error",
      });
    }
  }

  private isSuperseded(token: symbol | null, _turn: TurnContext) {
    return this.stale || token !== this.cancelToken;
  }

  private recover(text: string) {
    this.phase = "RECOVERING";
    this.notify({ type: "state", at: Date.now(), phase: "RECOVERING", text });
    this.recentMessages.push({ role: "assistant", text });
  }

  setSimulatedDelay(ms: number) {
    this.delayMs = ms;
    telemetry.record({ name: "delay.configured", at: Date.now(), value: ms });
  }

  /** Public interrupt while active, used by the demo "stop talking" path. */
  fenceActiveTurnPublic() {
    this.fenceActiveTurn("manual-stop");
  }

  setFallbackEnabled(enabled: boolean) {
    this.activeIsFallback = enabled;
    telemetry.record({
      name: "provider.switched",
      at: Date.now(),
      tags: { provider: enabled ? "fallback" : "rime" },
    });
  }

  reset() {
    this.program = defaultProgram(`session-${Date.now()}`);
    this.stale = true;
    this.cancelToken = null;
    this.stopPlaybackHard();
    this.recentMessages = [];
    this.phase = "IDLE";
    this.speechStartedAt = null;
    this.pendingInterruption = null;
    telemetry.reset();
    this.notify({ type: "state", at: Date.now(), phase: "IDLE" });
  }

  transcript() {
    return [...this.recentMessages];
  }

  private notify(e: EngineEvent) {
    for (const l of [...this.listeners]) l(e);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}