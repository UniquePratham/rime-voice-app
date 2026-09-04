import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side Rime TTS proxy.
 *
 * The RIME_API_KEY lives only here (and in the server env). The browser never
 * sees credentials. Response echoes the exact provider/model/voice/language so
 * the client can surface the active Rime path honestly.
 */

const RIME_ENDPOINT = process.env.RIME_ENDPOINT ?? "https://users.rime.ai/v1/rime-tts";
const RIME_MODEL = process.env.RIME_MODEL ?? "mistv2";
const RIME_SPEAKER = process.env.RIME_SPEAKER ?? "astra";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const start = Date.now();

  const body = (await req.json().catch(() => null)) as
    | { text?: string; speaker?: string; modelId?: string; samplingRate?: number; speed?: number }
    | null;

  const text = (body?.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "missing text" }, { status: 400 });
  }

  const apiKey = process.env.RIME_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "RIME_API_KEY is not configured", code: "NO_KEY" },
      { status: 503 },
    );
  }

  try {
    const upstream = await fetch(RIME_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        speaker: body?.speaker ?? RIME_SPEAKER,
        text,
        modelId: body?.modelId ?? RIME_MODEL,
        samplingRate: body?.samplingRate ?? 24000,
        speed: body?.speed ?? 1,
      }),
      // Rime + judge environments vary; give the upstream generous room for a cold start.
      signal: AbortSignal.timeout(20_000),
    });

    const requestMs = Date.now() - start;

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `rime upstream ${upstream.status}`,
          detail: detail.slice(0, 300),
          code: "UPSTREAM_ERROR",
        },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    let audioBase64: string | null = null;
    let format = "wav";

    if (isJson) {
      const json = (await upstream.json()) as Record<string, unknown>;
      for (const key of ["audioContent", "audio", "audio_base64", "base64"]) {
        const v = json[key];
        if (typeof v === "string" && v.length > 100) {
          audioBase64 = v;
          format = "wav";
          break;
        }
      }
      if (!audioBase64) {
        // legacy /prod layout returns per-verbosity payloads
        for (const v of Object.values(json)) {
          if (v && typeof v === "object" && "audioContent" in (v as object)) {
            const c = (v as { audioContent?: unknown }).audioContent;
            if (typeof c === "string" && c.length > 100) {
              audioBase64 = c;
              break;
            }
          }
        }
        if (!audioBase64) {
          return NextResponse.json(
            { ok: false, error: "rime upstream returned unexpected JSON", code: "BAD_PAYLOAD" },
            { status: 502 },
          );
        }
      }
    } else {
      // Raw audio body (e.g. binary wav) — envelope it for the client.
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (!buf.length) {
        return NextResponse.json({ ok: false, error: "rime upstream returned empty audio", code: "EMPTY_AUDIO" }, { status: 502 });
      }
      format = contentType.includes("mp3") ? "mp3" : "wav";
      audioBase64 = buf.toString("base64");
    }

    return NextResponse.json({
      ok: true,
      audioBase64,
      format,
      provider: "rime",
      model: body?.modelId ?? RIME_MODEL,
      voice: body?.speaker ?? RIME_SPEAKER,
      language: "en-US",
      endpoint: RIME_ENDPOINT,
      requestMs,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "proxy failure";
    return NextResponse.json({ ok: false, error: message, code: "PROXY_ERROR" }, { status: 502 });
  }
}