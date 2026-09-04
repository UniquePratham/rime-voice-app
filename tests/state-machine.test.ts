import { describe, expect, it } from "vitest";
import { createVoiceMachine } from "@/lib/state-machine";

describe("interruptible voice state machine", () => {
  it("moves IDLE → LISTENING on USER_SPEECH_START", () => {
    const m = createVoiceMachine();
    const r = m.dispatch("USER_SPEECH_START");
    expect(r.accepted).toBe(true);
    expect(r.to).toBe("LISTENING");
    expect(m.state).toBe("LISTENING");
  });

  it("rejects invalid transitions explicitly", () => {
    const m = createVoiceMachine();
    const r = m.dispatch("SPEECH_FENCED"); // not allowed in IDLE
    expect(r.accepted).toBe(false);
    expect(m.state).toBe("IDLE");
  });

  it("fences stale speech: SPEECH_FENCED in SPEAKING with inactive turn recovers, never re-speaks", () => {
    const m = createVoiceMachine({ turnId: "t-1", generationId: "g-1", active: true });
    m.dispatch("USER_SPEECH_START");
    m.dispatch("USER_SPEECH_END");
    m.dispatch("INTENT_PARSED");
    m.dispatch("TOOL_STARTED");
    m.dispatch("TOOL_RESULT");
    m.dispatch("SYNTH_REQUESTED");
    m.dispatch("SPEECH_STARTED");
    expect(m.state).toBe("SPEAKING");

    // user barges in — turn becomes stale
    m.markTurnStale();
    m.dispatch("SPEECH_FENCED");
    expect(m.state).toBe("RECOVERING");
    expect(m.snapshot.fencedSpeaks).toBe(1);
  });

  it("does not count a valid completed speech as fenced", () => {
    const m = createVoiceMachine({ active: true });
    m.dispatch("USER_SPEECH_START");
    m.dispatch("USER_SPEECH_END");
    m.dispatch("INTENT_PARSED");
    m.dispatch("SPEECH_STARTED");
    m.dispatch("SPEECH_FINISHED");
    expect(m.state).toBe("COMPLETED");
    expect(m.snapshot.fencedSpeaks).toBe(0);
  });

  it("counts stale tool results as rejected and never advances them", () => {
    const m = createVoiceMachine({ turnId: "t-1", generationId: "g-1", active: true });
    m.dispatch("USER_SPEECH_START");
    m.dispatch("USER_SPEECH_END");
    m.dispatch("INTENT_PARSED");
    m.dispatch("TOOL_STARTED");
    m.markTurnStale();
    const r = m.dispatch("TOOL_RESULT");
    expect(r.accepted).toBe(true);
    expect(m.state).not.toBe("SPEAKING");
    expect(m.snapshot.staleRejected).toBeGreaterThan(0);
    expect(m.snapshot.turn.active).toBe(false);
  });

  it("suppresses duplicate finish events", () => {
    const m = createVoiceMachine({ active: true });
    m.dispatch("USER_SPEECH_START");
    m.dispatch("USER_SPEECH_END");
    m.dispatch("INTENT_PARSED");
    m.dispatch("SPEECH_STARTED");
    m.dispatch("SPEECH_FINISHED");
    const before = m.snapshot.stateChangedAt;
    m.dispatch("SPEECH_FINISHED"); // already COMPLETED — rejected
    expect(m.state).toBe("COMPLETED");
    expect(m.snapshot.stateChangedAt).toBe(before);
  });

  it("returns to LISTENING when the user barges in mid-interrupt", () => {
    const m = createVoiceMachine({ active: true });
    m.dispatch("USER_SPEECH_START");
    m.dispatch("USER_SPEECH_END");
    m.dispatch("INTENT_PARSED");
    m.dispatch("SPEECH_STARTED");
    m.markTurnStale();
    m.dispatch("USER_INTERRUPT");
    expect(m.state).toBe("INTERRUPTING");
    m.beginTurn("t-2", "g-2");
    m.dispatch("USER_SPEECH_START");
    expect(m.state).toBe("LISTENING");
  });
});