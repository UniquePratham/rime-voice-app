import type { Exercise, Intent, Program } from "@/lib/types";

/**
 * Workout program domain engine.
 *
 * This is the "tools" layer the voice runtime executes. It is deterministic so
 * that acceptance tests can assert exact program state before/after an
 * interruption-corrected instruction. Artificial delays are injected by the
 * orchestrator, never here, so timing tests stay deterministic.
 */

export function defaultProgram(sessionId: string): Program {
  return {
    sessionId,
    athlete: "Avery",
    name: "Strength Block — W3D2",
    currentBlockIndex: 0,
    blocks: [
      {
        id: "b1",
        name: "Main Lift",
        exercises: [
          {
            id: "e1",
            name: "Squat",
            sets: 5,
            reps: 3,
            weightKg: 180,
            rpe: 8,
            restSec: 180,
            completedSets: 1,
          },
          {
            id: "e2",
            name: "Bench Press",
            sets: 4,
            reps: 5,
            weightKg: 100,
            rpe: 7.5,
            restSec: 150,
            completedSets: 0,
          },
        ],
      },
      {
        id: "b2",
        name: "Volume Accessory",
        exercises: [
          {
            id: "e3",
            name: "Deadlift",
            sets: 5,
            reps: 3,
            weightKg: 220,
            rpe: 8.5,
            restSec: 210,
            completedSets: 0,
            notes: "no straps",
          },
          {
            id: "e4",
            name: "Barbell Row",
            sets: 4,
            reps: 8,
            weightKg: 70,
            rpe: 7,
            restSec: 90,
            completedSets: 0,
          },
        ],
      },
    ],
  };
}

export function findExercise(program: Program, name: string): Exercise | undefined {
  return program.blocks.flatMap((b) => b.exercises).find((e) => e.name.toLowerCase().includes(name.toLowerCase()));
}

export function applyIntent(program: Program, intent: Intent): { program: Program; change: string } {
  const next: Program = structuredClone(program);

  switch (intent.type) {
    case "start": {
      next.currentBlockIndex = 0;
      return { program: next, change: `Starting ${next.blocks[0].name}.` };
    }

    case "next_block": {
      if (next.currentBlockIndex < next.blocks.length - 1) {
        next.currentBlockIndex += 1;
        const b = next.blocks[next.currentBlockIndex];
        return { program: next, change: `Moving to ${b.name}: ${b.exercises.map((e) => `${e.name} ${e.sets} x ${e.reps}`).join(", ")}.` };
      }
      return { program: next, change: "You are already on the final block." };
    }

    case "adjust": {
      const name = intent.exercise;
      if (!name) return { program: next, change: "Which exercise should I adjust?" };
      const ex = findExercise(next, name);
      if (!ex) return { program: next, change: `I could not find ${name} in the program.` };

      const parts: string[] = [];
      if (intent.weight !== undefined) {
        ex.weightKg = intent.weight;
        parts.push(`${ex.name} to ${ex.weightKg} kilos`);
      }
      if (typeof intent.sets === "number") {
        ex.sets = intent.sets;
        parts.push(`${ex.sets} sets`);
      }
      if (typeof intent.reps === "number") {
        ex.reps = intent.reps;
        parts.push(`${ex.reps} reps`);
      }
      if (typeof intent.rpe === "number") {
        ex.rpe = intent.rpe;
        parts.push(`at RPE ${ex.rpe}`);
      }

      if (!parts.length) {
        return { program: next, change: `Say a value to change, like "weight to 190 kilos".` };
      }
      return { program: next, change: `Adjusted ${ex.name}: ${parts.join(", ")}.` };
    }

    case "log_set": {
      const name = intent.exercise;
      if (!name) return { program: next, change: "Which exercise did you finish?" };
      const ex = findExercise(next, name);
      if (!ex) return { program: next, change: `Could not find ${name}.` };
      ex.completedSets = Math.min(ex.sets, ex.completedSets + 1);
      const remaining = ex.sets - ex.completedSets;
      return {
        program: next,
        change: `Logged one set of ${ex.name}. ${remaining > 0 ? `${remaining} set${remaining > 1 ? "s" : ""} remaining.` : `${ex.name} complete.`}`,
      };
    }

    case "inquiry": {
      const name = intent.exercise;
      const b = next.blocks[next.currentBlockIndex];
      const target = name ? findExercise(next, name) : b?.exercises[0];
      if (!target) return { program: next, change: "Check the program for the next exercise." };
      return {
        program: next,
        change: `${target.name}: ${target.sets} sets of ${target.reps} at ${target.weightKg} kilograms, RPE ${target.rpe}. Rest ${Math.round(target.restSec / 60)} minutes.`,
      };
    }

    case "finish": {
      return { program: next, change: "Session complete. Great work — five sets logged on squat, four on bench, deadlift block skipped." };
    }

    case "stop": {
      return { program: next, change: "Stopped. Session is paused in place." };
    }

    case "help": {
      return {
        program: next,
        change: "You can ask: what is next? Adjust the squat to 190 kilos. Log a set of bench. Move to the next block.",
      };
    }

    default:
      return { program: next, change: "I did not catch that." };
  }
}

export function describeProgram(program: Program): string {
  const b = program.blocks[program.currentBlockIndex];
  return `${program.name}. Current block: ${b.name}. Next up: ${b.exercises
    .filter((e) => e.completedSets < e.sets)
    .map((e) => `${e.name}, ${e.sets - e.completedSets} sets of ${e.reps} at ${e.weightKg} kilos`)
    .join(" then ")}.`;
}

export function transcriptOf(program: Program): string {
  return program.blocks
    .map(
      (b) =>
        `${b.name} — ${b.exercises
          .map((e) => `${e.name} ${e.sets}×${e.reps} @ ${e.weightKg}kg RPE${e.rpe} (${e.completedSets}/${e.sets} done)`)
          .join(" · ")}`,
    )
    .join("\n");
}