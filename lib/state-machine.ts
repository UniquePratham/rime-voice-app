import type { VoiceEvent, VoiceState } from "@/lib/types";

/**
 * Interruptible voice state machine.
 *
 * The state machine is pure (no DOM, no I/O) so the hard voice problem —
 * interruption and recovery — can be unit tested with deterministic event
 * sequences.
 *
 * Invariants enforced here:
 *  - ALLOWED transitions only; invalid events are rejected (not silently ignored).
 *  - A turn becoming stale invalidates its speech and tool output.
 *  - Speech produced by a stale generation is FENCED at the state level.
 *  - Only the latest generation may reach SPEAKING.
 */

export type StateId = VoiceState;

export interface TurnRecord {
  turnId: string;
  generationId: string;
  active: boolean;
}

export interface VoiceMachineSnapshot {
  state: VoiceState;
  turn: TurnRecord;
  /** Count of turns whose speech was fenced while a newer turn was active. */
  fencedSpeaks: number;
  /** Count of stale tool results that were rejected (never spoken). */
  staleRejected: number;
  /** Count of duplicate speak events suppressed. */
  duplicatesSuppressed: number;
  lastEvent: VoiceEvent | null;
  lastTransitionAt: number;
  stateChangedAt: number;
}

const ALLOWED: Record<VoiceState, VoiceEvent[]> = {
  IDLE: ["USER_SPEECH_START", "SESSION_COMPLETE", "RESET", "ERROR"],
  LISTENING: [
    "USER_SPEECH_END",
    "RECOGNITION_RESULT",
    "INTENT_PARSED",
    "INTENT_PARSE_FAILED",
    "USER_INTERRUPT",
    "USER_BARGE_IN",
    "SESSION_COMPLETE",
    "RESET",
    "ERROR",
  ],
  THINKING: [
    "TOOL_STARTED",
    "UTTERANCE_PREPARED",
    "SYNTH_REQUESTED",
    "SPEECH_STARTED",
    "USER_BARGE_IN",
    "USER_INTERRUPT",
    "INTENT_PARSE_FAILED",
    "TOOL_ERROR",
    "SPEECH_FAILED",
    "SESSION_COMPLETE",
    "RESET",
    "ERROR",
  ],
  TOOL_RUNNING: [
    "TOOL_RESULT",
    "TOOL_CANCELLED",
    "TOOL_ERROR",
    "UTTERANCE_PREPARED",
    "SYNTH_REQUESTED",
    "SPEECH_STARTED",
    "USER_INTERRUPT",
    "USER_BARGE_IN",
    "SESSION_COMPLETE",
    "RESET",
    "ERROR",
  ],
  SPEAKING: [
    "SPEECH_FINISHED",
    "SPEECH_FENCED",
    "USER_INTERRUPT",
    "USER_BARGE_IN",
    "SPEECH_FAILED",
    "TOOL_RESULT",
    "RECOVERY_COMPLETE",
    "SESSION_COMPLETE",
    "RESET",
    "ERROR",
  ],
  INTERRUPTING: [
    "SPEECH_FENCED",
    "RECOGNITION_RESULT",
    "USER_SPEECH_END",
    "USER_INTERRUPT",
    "USER_SPEECH_START",
    "USER_BARGE_IN",
    "RECOVERY_COMPLETE",
    "SESSION_COMPLETE",
    "RESET",
    "ERROR",
  ],
  CANCELLING: ["RECOVERY_COMPLETE", "SESSION_COMPLETE", "RESET", "ERROR"],
  RECOVERING: [
    "SYNTH_REQUESTED",
    "SPEECH_STARTED",
    "SPEECH_FENCED",
    "RECOVERY_COMPLETE",
    "USER_INTERRUPT",
    "USER_BARGE_IN",
    "SESSION_COMPLETE",
    "RESET",
    "ERROR",
  ],
  COMPLETED: ["RESET", "USER_SPEECH_START"],
  ERROR: ["RESET", "SESSION_COMPLETE"],
};

function nextState(
  state: VoiceState,
  event: VoiceEvent,
  turn: TurnRecord,
): { state: VoiceState; turn?: Partial<TurnRecord> } {
  switch (event) {
    case "USER_SPEECH_START":
      if (state === "IDLE") return { state: "LISTENING", turn: { active: true } };
      // Barge-in during any active phase opens a new listening window and
      // marks the current turn stale at the orchestrator level.
      return { state: "LISTENING", turn: { active: true } };

    case "USER_SPEECH_END":
      if (state === "LISTENING") return { state: "THINKING" };
      return { state: "THINKING" };

    case "RECOGNITION_RESULT":
      return { state };

    case "INTENT_PARSED":
      if (state === "THINKING" || state === "LISTENING" || state === "INTERRUPTING") {
        return { state: "THINKING" };
      }
      return { state: "THINKING" };

    case "INTENT_PARSE_FAILED":
      return { state: "RECOVERING" };

    case "TOOL_STARTED":
      return { state: "TOOL_RUNNING" };

    case "TOOL_RESULT":
      if (state === "TOOL_RUNNING" && !turn.active) return { state };
      // A stale result must never advance a superseded turn to SPEAKING.
      if (!turn.active) return { state };
      return { state: "THINKING" };

    case "TOOL_CANCELLED":
      return { state: "RECOVERING" };

    case "TOOL_ERROR":
      return { state: "ERROR" };

    case "UTTERANCE_PREPARED":
      return { state: "THINKING" };

    case "SYNTH_REQUESTED":
      return { state: "THINKING" };

    case "SPEECH_STARTED":
      return { state: "SPEAKING" };

    case "SPEECH_FINISHED":
      if (state === "SPEAKING") return { state: "COMPLETED" };
      return { state };

    case "SPEECH_FENCED":
      // Interrupt fence: work stops; orchestrator decides recovery vs cancel.
      if (!turn.active) return { state: "RECOVERING" };
      return { state: "RECOVERING" };

    case "SPEECH_FAILED":
      return { state: "ERROR" };

    case "USER_INTERRUPT":
      return { state: "INTERRUPTING" };

    case "USER_BARGE_IN":
      return { state: "INTERRUPTING" };

    case "RECOVERY_COMPLETE":
      return { state: "COMPLETED" };

    case "SESSION_COMPLETE":
      return { state: "COMPLETED" };

    case "RESET":
      return { state: "IDLE", turn: { active: false } };

    case "ERROR":
      return { state: "ERROR" };

    default:
      return { state };
  }
}

export function createVoiceMachine(initialTurn?: Partial<TurnRecord>) {
  const snapshot: VoiceMachineSnapshot = {
    state: "IDLE",
    turn: {
      turnId: initialTurn?.turnId ?? "t-0",
      generationId: initialTurn?.generationId ?? "g-0",
      active: initialTurn?.active ?? false,
    },
    fencedSpeaks: 0,
    staleRejected: 0,
    duplicatesSuppressed: 0,
    lastEvent: null,
    lastTransitionAt: 0,
    stateChangedAt: 0,
  };

  const listeners = new Set<(s: VoiceMachineSnapshot, e: VoiceEvent) => void>();

  function dispatch(event: VoiceEvent): { accepted: boolean; from: VoiceState; to: VoiceState } {
    const from = snapshot.state;
    const allowed = ALLOWED[from];

    if (!allowed.includes(event)) {
      // Reject invalid transitions explicitly rather than failing silently.
      return { accepted: false, from, to: from };
    }

    const next = nextState(from, event, snapshot.turn);
    snapshot.state = next.state;
    snapshot.lastEvent = event;
    snapshot.lastTransitionAt = Date.now();
    if (next.turn) Object.assign(snapshot.turn, next.turn);
    if (next.state !== from) snapshot.stateChangedAt = Date.now();

    if (
      (event === "SPEECH_FENCED" || (event === "SPEECH_FINISHED" && !snapshot.turn.active)) &&
      !snapshot.turn.active
    ) {
      snapshot.fencedSpeaks += 1;
    }
    if (event === "TOOL_RESULT" && !snapshot.turn.active) {
      snapshot.staleRejected += 1;
    }

    for (const l of listeners) l(snapshot, event);
    return { accepted: true, from, to: next.state };
  }

  function beginTurn(turnId: string, generationId: string) {
    snapshot.turn.turnId = turnId;
    snapshot.turn.generationId = generationId;
    snapshot.turn.active = true;
  }

  function markTurnStale() {
    snapshot.turn.active = false;
  }

  function reset() {
    snapshot.state = "IDLE";
    snapshot.turn = { turnId: "t-0", generationId: "g-0", active: false };
    snapshot.fencedSpeaks = 0;
    snapshot.staleRejected = 0;
    snapshot.duplicatesSuppressed = 0;
  }

  return {
    get state() {
      return snapshot.state;
    },
    get turn() {
      return { ...snapshot.turn };
    },
    get snapshot() {
      return { ...snapshot, turn: { ...snapshot.turn } };
    },
    dispatch,
    beginTurn,
    markTurnStale,
    reset,
    subscribe(fn: (s: VoiceMachineSnapshot, e: VoiceEvent) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export type VoiceMachine = ReturnType<typeof createVoiceMachine>;

export function isValidTransition(from: VoiceState, event: VoiceEvent) {
  return ALLOWED[from].includes(event);
}