"use client";

interface OrbProps {
  phase: string;
  level: number;
  status: string;
  onInterrupt: () => void;
}

const STATE_LABEL: Record<string, string> = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  TOOL_RUNNING: "updating program",
  SPEAKING: "speaking (rime)",
  INTERRUPTING: "interrupting",
  RECOVERING: "recovering",
  COMPLETED: "done",
  ERROR: "error",
  CANCELLING: "cancelling",
};

export function Orb({ phase, level, status, onInterrupt }: OrbProps) {
  const listening = phase === "LISTENING";
  const speaking = phase === "SPEAKING";

  return (
    <button
      type="button"
      className="orb"
      data-state={phase}
      onClick={onInterrupt}
      aria-label={
        speaking
          ? "Spotter is speaking. Press to interrupt."
          : listening
            ? "Listening. Keep holding and release when finished."
            : `Mode: ${STATE_LABEL[phase] ?? phase}. ${status}`
      }
      aria-pressed={phase === "LISTENING"}
    >
      {speaking && <span className="orb-ripple" aria-hidden="true" />}
      {listening && <span className="orb-pulse" aria-hidden="true" />}
      <span className="orb-status" aria-hidden="true">
        {STATE_LABEL[phase] ?? phase}
      </span>
      <span className="orb-core">
        {listening && (
          <>
            <span style={{ width: `${12 + level * 60}px`, height: 2, background: "var(--color-accent)", display: "inline-block" }} aria-hidden="true" />
            <span>{Math.round(level * 100)}</span>
          </>
        )}
        {speaking && (
          <span className="orb-core-meta">interrupt anytime</span>
        )}
        {!listening && !speaking && (
          <span className="orb-core-meta">{phase === "IDLE" ? "spotter" : phase.toLowerCase()}</span>
        )}
      </span>
    </button>
  );
}