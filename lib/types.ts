export type VoiceState =
  | "IDLE"
  | "LISTENING"
  | "THINKING"
  | "TOOL_RUNNING"
  | "SPEAKING"
  | "INTERRUPTING"
  | "CANCELLING"
  | "RECOVERING"
  | "COMPLETED"
  | "ERROR";

export type VoiceEvent =
  | "USER_SPEECH_START"
  | "USER_SPEECH_END"
  | "USER_INTERRUPT"
  | "USER_BARGE_IN"
  | "RECOGNITION_RESULT"
  | "INTENT_PARSED"
  | "INTENT_PARSE_FAILED"
  | "TOOL_STARTED"
  | "TOOL_RESULT"
  | "TOOL_CANCELLED"
  | "TOOL_ERROR"
  | "UTTERANCE_PREPARED"
  | "SYNTH_REQUESTED"
  | "SYNTH_CHUNK"
  | "SPEECH_STARTED"
  | "SPEECH_FINISHED"
  | "SPEECH_FENCED"
  | "SPEECH_FAILED"
  | "RECOVERY_COMPLETE"
  | "SESSION_COMPLETE"
  | "RESET"
  | "ERROR";

export interface TurnContext {
  turnId: string;
  generationId: string;
  createdAt: number;
  userText?: string;
  intent?: Intent;
  toolName?: string;
  toolStartedAt?: number;
  toolFinishedAt?: number;
  lastSpoken?: string;
}

export type IntentType =
  | "inquiry" // informational
  | "adjust" // modify program/weight/reps/sets
  | "log_set" // record a completed set
  | "next_block" // advance to next exercise or block
  | "start" // begin workout
  | "finish" // end workout
  | "stop" // stop everything
  | "help";

export interface Intent {
  type: IntentType;
  exercise?: string;
  weight?: number;
  reps?: number;
  sets?: number;
  rpe?: number;
  note?: string;
  raw: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  toolName: string;
  generationId: string;
  turnId: string;
  startedAt: number;
  finishedAt: number;
  /** Deterministic artificial delay injected for the acceptance test. */
  simulatedDelayMs: number;
  /** true when this result belongs to a superseded turn (stale). */
  stale: boolean;
}

export interface Utterance {
  turnId: string;
  generationId: string;
  text: string;
  preparedAt: number;
}

export interface SpeechSession {
  turnId: string;
  generationId: string;
  utterance: Utterance;
  startedAt: number;
  state: "buffering" | "playing" | "fenced" | "done" | "failed";
}

export interface EngineEvent {
  type: "state" | "telemetry" | "speech";
  at: number;
  [key: string]: unknown;
}

export interface TelemetrySample {
  name: string;
  at: number;
  turnId?: string;
  generationId?: string;
  durationMs?: number;
  value?: number;
  tags?: Record<string, string | number | boolean>;
}

export interface VoiceConfig {
  provider: "rime" | "fallback" | "none";
  model: string;
  voice: string;
  language: string;
  endpoint: string;
  audioFormat: string;
  transport: string;
}

export interface RimeSynthesisTimings {
  requestSentAt: number;
  requestReceiptAt?: number;
  firstChunkAt?: number;
  chunks: number;
  totalBytes: number;
  synthDurationMs?: number;
  playbackStartedAt?: number;
  playbackEndedAt?: number;
}

export interface ProviderRecord {
  provider: string;
  model: string;
  voice: string;
  language: string;
  endpoint: string;
  audioFormat: string;
  transport: string;
  requestTimingMs?: number;
  synthesisTimingMs?: number;
  playbackTimingMs?: number;
  interruptionAt?: number;
  interrupted: boolean;
  usedFallback: boolean;
}

export interface InterruptionMetrics {
  interruptions: InterruptionSample[];
}

export interface InterruptionSample {
  at: number;
  speechStartedAt: number;
  audioStoppedAt: number;
  listeningAt: number;
  audioStopLatencyMs: number;
  speechToListeningMs: number;
  staleSuppressed: boolean;
  recoveryOk: boolean;
  finalTurnId: string;
  partial?: string;
}

export interface Program {
  sessionId: string;
  athlete: string;
  name: string;
  blocks: ProgramBlock[];
  currentBlockIndex: number;
}

export interface ProgramBlock {
  id: string;
  name: string;
  exercises: Exercise[];
}

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weightKg: number;
  rpe: number;
  restSec: number;
  completedSets: number;
  notes?: string;
}

export interface ParseOutcome {
  provider: "ai" | "local";
  intent?: Intent;
  spokenText?: string;
  confidence?: number;
}

/* ---------- Voice engine abstraction ---------- */

export interface PlaybackHandles {
  stop: () => void;
  finished: Promise<void>;
}

export interface VoiceEngine {
  readonly name: string;
  readonly config: VoiceConfig;

  synthesize(utterance: Utterance): Promise<PlaybackHandles>;

  /** Stop and fence all playback immediately. Resolves once audio is quiet. */
  stopAll(): Promise<void>;

  /** Provider-level details recorded for telemetry and evidence. */
  providerRecord(): ProviderRecord;
}