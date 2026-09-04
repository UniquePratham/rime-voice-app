import { NextResponse } from "next/server";
import type { Intent, ParseOutcome } from "@/lib/types";
import { parseLocal } from "@/lib/intent";

/**
 * Free-form speech → structured intent, via an LLM when an OpenAI-compatible
 * key is configured. Without a key this returns the deterministic local parse
 * and reports provider: "local". The active provider is surfaced to the eval
 * panel and telemetry — the mode is never hidden.
 */

const SYSTEM = `You extract workout-coaching intents from spoken English for a strength program.
Valid intent types: start, next_block, adjust, log_set, inquiry, finish, stop, help.
An "adjust" intent changes weight (kg), sets, reps, and/or rpe. Extract numbers precisely.
Examples:
- "drop the deadlift to 180 kilos" -> {"type":"adjust","exercise":"deadlift","weight":180}
- "actually make it 3 sets of 5" -> {"type":"adjust","exercise":null,"sets":3,"reps":5}
- "what is the next exercise" -> {"type":"inquiry"}
- "log a set of bench press at 100 kilos" -> {"type":"log_set","exercise":"bench press","weight":100}
Return ONLY compact JSON.`;

const EXERCISES = ["squat", "bench press", "deadlift", "barbell row"];

function localOutcome(text: string): ParseOutcome {
  const intent = parseLocal(text);
  // resolve free-text exercise aliases the local parser may have missed
  if (!intent.exercise) {
    const lower = text.toLowerCase();
    const hit = EXERCISES.find((e) => lower.includes(e));
    if (hit) intent.exercise = hit;
  }
  return { provider: "local", intent };
}

export const maxDuration = 30;

export async function POST(req: Request) {
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text || !text.trim()) {
    return NextResponse.json(localOutcome("help"));
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return NextResponse.json(localOutcome(text));
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return NextResponse.json(localOutcome(text));

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = content
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const intent = JSON.parse(parsed) as Intent;
    if (intent && typeof intent.type === "string") {
      intent.raw = text.trim();
      return NextResponse.json({ provider: "ai", intent });
    }
    return NextResponse.json(localOutcome(text));
  } catch {
    return NextResponse.json(localOutcome(text));
  }
}