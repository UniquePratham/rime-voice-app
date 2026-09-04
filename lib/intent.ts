import type { Intent, ParseOutcome } from "@/lib/types";

/**
 * Intent parsing.
 *
 * Primary path: the /api/understand endpoint which uses an LLM when an
 * OPENAI_API_KEY is configured. Fallback path: this deterministic local
 * parser, so the product works and the acceptance test is reproducible
 * without external credentials. The active `provider` field is surfaced in
 * telemetry and the eval panel — the mode is never hidden.
 */

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  "a": 1,
  "an": 1,
};

const EXERCISE_ALIASES: Record<string, string[]> = {
  squat: ["squat", "squats"],
  "bench press": ["bench", "bench press"],
  deadlift: ["deadlift", "deadlifts", "deadlift block"],
  "barbell row": ["row", "barbell row", "rows"],
};

export function parseLocal(text: string): Intent {
  const t = text.toLowerCase().replace(/[.,!?]/g, " ");
  const raw = text.trim();

  const exercise = (() => {
    for (const [canonical, aliases] of Object.entries(EXERCISE_ALIASES)) {
      for (const a of aliases) {
        if (t.includes(a)) return { canonical, match: a };
      }
    }
    return undefined;
  })();

  const hasNumber = () => /\d/.test(t);
  const num = (re: RegExp) => {
    const m = t.match(re);
    if (!m) return undefined;
    if (/\d/.test(m[1])) return parseFloat(m[1]);
    return NUMBER_WORDS[m[1]];
  };

  const weight = num(/weight\s*(?:to)?\s*(?:(\d+(?:\.\d+)?)|(?:(\d+)\s*(?:kilos?|kg)))/);
  const weightExplicit = t.match(/(\d+(?:\.\d+)?)\s*(?:kilos?|kg)/);
  const weightKg = weightExplicit ? parseFloat(weightExplicit[1]) : weight;

  const setsCandidates = t.match(/(\d+)\s*sets?\s*(?:of\s*|\s*)?(?:(\d+))?/);
  const rawSets = setsCandidates?.[1];
  const sets = rawSets ? parseFloat(rawSets) : undefined;
  const repsAfterSets = setsCandidates?.[2] ? parseFloat(setsCandidates[2]) : undefined;

  const repsCandidates = t.match(/(\d+)\s*reps?/);
  const reps = repsCandidates ? parseFloat(repsCandidates[1]) : repsAfterSets;

  const rpe = t.match(/rpe\s*(\d(?:\.\d+)?)/)?.[1];

  const hasWeight = weightKg !== undefined || hasNumber();
  const adjusting =
    /(drop|lower|reduce|up|bump|raise|increase|change|set|make|adjust|to)\b/.test(t) &&
    (hasWeight || sets !== undefined || reps !== undefined);

  if (/(stop|pause|cancel that|forget it)/.test(t)) {
    return { type: "stop", exercise: exercise?.canonical, raw };
  }
  if (/(log\s+(?:a\s+)?set|finished\s+(?:a\s+)?set|done with)/.test(t)) {
    return {
      type: "log_set",
      exercise: exercise?.canonical,
      weight: weightKg,
      reps,
      sets,
      raw,
    };
  }
  if (/(next|move on|advance|what'?s next|what is next)/.test(t)) {
    return { type: "next_block", exercise: exercise?.canonical, raw };
  }
  if (/(start|begin|kick off|let'?s go|go live)/.test(t)) {
    return { type: "start", exercise: exercise?.canonical, raw };
  }
  if (/(finish|done|wrap up|end the session|complete)/.test(t)) {
    return { type: "finish", exercise: exercise?.canonical, raw };
  }
  if (/(help|what can you do|what should i say)/.test(t)) {
    return { type: "help", raw };
  }
  if (adjusting) {
    return {
      type: "adjust",
      exercise: exercise?.canonical,
      weight: weightKg,
      sets,
      reps,
      rpe: rpe ? parseFloat(rpe) : undefined,
      raw,
    };
  }
  if (/(tell me|what'?s|what is|show me|next|load|program|current)/.test(t)) {
    return { type: "inquiry", exercise: exercise?.canonical, raw };
  }

  return { type: "inquiry", exercise: exercise?.canonical, raw };
}

export async function parseIntent(text: string, hasAi: boolean): Promise<ParseOutcome> {
  if (hasAi && typeof window !== "undefined") {
    try {
      const res = await fetch("/api/understand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const json = (await res.json()) as ParseOutcome;
        if (json.intent) return { ...json, provider: json.provider ?? "ai" };
      }
    } catch {
      // fall through to local parser; the failure is recorded by the caller
    }
  }
  return { provider: "local", intent: parseLocal(text) };
}