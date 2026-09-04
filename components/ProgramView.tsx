"use client";

import type { Program } from "@/lib/types";

interface ProgramViewProps {
  program: Program;
}

export function ProgramView({ program }: ProgramViewProps) {
  return (
    <div className="panel">
      <div className="program-head">
        <div>
          <p className="display-lg" style={{ margin: 0 }}>
            {program.name}
          </p>
          <p className="label" style={{ margin: "4px 0 0" }}>
            athlete · {program.athlete} · session {program.sessionId}
          </p>
        </div>
      </div>

      {program.blocks.map((block, bi) => {
        const active = bi === program.currentBlockIndex;
        return (
          <section
            key={block.id}
            className="block"
            aria-label={`${block.name}${active ? " — active block" : ""}`}
          >
            <p className="block-label">
              <span>{block.name}</span>
              <span style={{ color: active ? "var(--color-accent)" : undefined }}>
                {active ? "● active" : "later"}
              </span>
            </p>
            {block.exercises.map((ex) => {
              const done = ex.completedSets >= ex.sets;
              return (
                <div className="ex-row" key={ex.id}>
                  <div>
                    <p className="ex-name" style={{ margin: 0 }}>
                      {ex.name}
                      {done && <span style={{ color: "var(--color-success)", marginLeft: 8 }}>✓</span>}
                    </p>
                    <p className="ex-spec" style={{ margin: 0 }}>
                      <span>
                        {ex.weightKg} kg
                      </span>
                      <span>
                        {ex.sets}×{ex.reps}
                      </span>
                      <span>RPE {ex.rpe}</span>
                      <span>rest {Math.round(ex.restSec / 60)}′</span>
                    </p>
                  </div>
                  <p className="ex-progress" style={{ margin: 0 }}>
                    {ex.completedSets}/{ex.sets}
                  </p>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}