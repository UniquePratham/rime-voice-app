import { describe, expect, it, beforeEach } from "vitest";
import { ControlledEngine, waitUntil } from "./helpers";
import { ConversationRuntime } from "@/lib/conversation";
import { telemetry } from "@/lib/telemetry";

function runtimeWith(fake: ControlledEngine, delayMs: number) {
  const fb = new ControlledEngine();
  return new ConversationRuntime(fake as never, fb as never, { simulateDelayMs: delayMs, useAi: false });
}

beforeEach(() => {
  telemetry.reset();
});

describe("acceptance: interruption during speech + delayed tool", () => {
  it("regression — the stale response is never spoken after a correction", async () => {
    const engine = new ControlledEngine(true);
    const rt = runtimeWith(engine, 120);

    let state: string = "IDLE";
    const spoke: string[] = [];
    rt.on((e) => {
      if (e.type === "state") {
        state = String(e.phase);
        if (e.phase === "SPEAKING") spoke.push(String(e.text ?? ""));
      }
    });

    // 1. Start a conversation
    rt.beginInput();
    const firstTurn = rt.endInput("what is next");
    await waitUntil(() => state === "THINKING", 2000, "first turn thinking");
    await waitUntil(() => state === "TOOL_RUNNING", 2000, "tool running");

    // 2. The tool resolves after the deterministic delay
    await waitUntil(() => engine.utterances.length > 0, 2500, "first synth requested");
    expect(engine.utterances).toHaveLength(1);
    expect(engine.utterances[0].utterance.text).toContain("Moving to Volume Accessory");

    // 3. Agent begins speaking
    await waitUntil(() => state === "SPEAKING", 2000, "agent speaking");
    engine.resolveCurrentSynth();

    // 4. User interrupts mid-speech and changes a parameter
    rt.beginInput();
    await waitUntil(() => engine.utterances[0].stopped === true, 1500, "old audio stopped");

    // 5. Updated instruction becomes the authoritative state
    const corrected = rt.endInput("actually drop the deadlift to 200 kilos, 3 sets of 5");
    await waitUntil(() => engine.utterances.length >= 2, 2000, "second synth requested");
    engine.driveAllToCompletion();
    await waitUntil(() => state === "COMPLETED", 4000, "recovered to COMPLETED");
    await corrected;

    await firstTurn;

    // 6. The final spoken response is ONLY the correction output
    expect(spoke.length).toBeGreaterThanOrEqual(2);
    const lastCoachLine = spoke[spoke.length - 1];
    expect(lastCoachLine).toContain("Adjusted Deadlift");
    expect(lastCoachLine).toContain("200 kilos");
    expect(lastCoachLine).toContain("3 sets");
    expect(lastCoachLine).toContain("5 reps");

    // The stale first response must never appear as the final answer
    const staleIndex = spoke.findIndex((s) => s.includes("Moving to Volume Accessory"));
    expect(staleIndex).not.toBe(spoke.length - 1);

    // 7. Measured behavior
    const summary = telemetry.summary();
    expect(summary.interruptions).toBeGreaterThanOrEqual(1);
    const fenced = engine.utterances[0].stopped;
    expect(fenced).toBe(true);
  });

  it("stale TOOL_RUNNING result is rejected and never reaches SPEAKING", async () => {
    const engine = new ControlledEngine(true);
    const rt = runtimeWith(engine, 400);
    let state = "IDLE";
    const spoke: string[] = [];
    rt.on((e) => {
      if (e.type === "state") {
        state = String(e.phase);
        if (e.phase === "SPEAKING") spoke.push(String(e.text ?? ""));
      }
    });

    rt.beginInput();
    const first = rt.endInput("move to the next block");
    await waitUntil(() => state === "TOOL_RUNNING", 2000, "tool running");

    // Interrupt while the tool is still executing (before delay elapses)
    rt.beginInput();
    const corrected = rt.endInput("make the bench 4 sets of 3");
    await waitUntil(() => engine.utterances.length >= 1, 2000, "corrected synth requested");
    engine.driveAllToCompletion();
    await waitUntil(() => state === "COMPLETED", 4000, "completed");
    await corrected;
    await first;

    const rejected = telemetry.byName("stale.result.rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    // only the corrected response was spoken
    const lines = spoke;
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Adjusted Bench Press");
    expect(lines[0]).not.toContain("Moving");
  });
});

describe("normal conversation path", () => {
  it("speaks a single deterministic response for a simple inquiry", async () => {
    const engine = new ControlledEngine(true);
    const rt = runtimeWith(engine, 0);
    let state = "IDLE";
    const spoke: string[] = [];
    rt.on((e) => {
      if (e.type === "state") {
        state = String(e.phase);
        if (e.phase === "SPEAKING") spoke.push(String(e.text ?? ""));
      }
    });

    rt.beginInput();
    const turn = rt.endInput("what is the squat");
    await waitUntil(() => engine.utterances.length === 1, 2000, "synth requested");
    engine.driveAllToCompletion();
    await turn;
    await waitUntil(() => state === "COMPLETED", 2000, "completed");

    expect(spoke).toHaveLength(1);
    expect(spoke[0]).toContain("Squat");
    expect(spoke[0]).toContain("180 kilograms");
  });
});

describe("error handling", () => {
  it("records an error state when synthesis fails", async () => {
    const failing = new ControlledEngine(true);
    const rt = new ConversationRuntime(
      {
        ...failing,
        synthesize() {
          return Promise.reject(new Error("boom"));
        },
      } as never,
      new ControlledEngine() as never,
      { useAi: false },
    );

    let state = "IDLE";
    let errorMsg: string | undefined;
    rt.on((e) => {
      if (e.type === "state") {
        state = String(e.phase);
        errorMsg = e.phase === "ERROR" ? String(e.error ?? "") : errorMsg;
      }
    });

    rt.beginInput();
    await rt.endInput("what is next");
    expect(state).toBe("ERROR");
    expect(errorMsg).toContain("boom");
    expect(telemetry.byName("synth.failed").length).toBe(1);
  });
});