"use client";

import type { TranscriptLine } from "@/lib/use-session";

interface TranscriptProps {
  lines: TranscriptLine[];
  interim: string;
}

export function Transcript({ lines, interim }: TranscriptProps) {
  return (
    <div className="transcript" aria-live="polite" role="log" aria-relevant="additions">
      {lines.length === 0 && !interim && (
        <p className="label" style={{ margin: 0, padding: "var(--space-2) 0" }}>
          Instructions and spoken answers will appear here.
        </p>
      )}
      {lines.map((line, i) => (
        <div key={line.id} className="turn-line">
          <span className="turn-role" data-role={line.role} aria-hidden="true">
            {line.role === "coach" ? "spotter" : "you"}
          </span>
          <div>
            <p
              className="turn-text"
              data-role={line.role}
              data-fence={line.fence ? "true" : "false"}
            >
              {line.text}
            </p>
            {line.fence && (
              <span className="turn-stamp" role="status">
                cancelled — superseded by your correction
              </span>
            )}
            {i === lines.length - 1 && (
              <span className="turn-stamp" aria-hidden="true">
                {new Date(line.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      ))}
      {interim && (
        <div className="turn-line">
          <span className="turn-role" data-role="you" aria-hidden="true">
            you
          </span>
          <p className="turn-text interim">{interim}…</p>
        </div>
      )}
    </div>
  );
}