# Architecture

This document explains how Spotter achieves interruptible, consistent voice
output for the Rime Hackathon. Read it with the eye of a judge: *"something
difficult is happening under the hood, and it is measured."*

## Layers

```
            ┌──────────────────────────────────────────────┐
            │              BROWSER (React)                 │
            │                                              │
  mic ────► │ STT (Web Speech) ──► ConversationRuntime ──► │
            │        ▲                 │  │                │
            │      input level    intent┤  │               │
            │        monitor        parse│  │              │
            │                            ▼  ▼              │
            │  Intent → Tool engine → Rime VoiceEngine    │
            │                              │              │
            │                        WebAudio playback    │
            │                        (hard-stop = fence)  │
            └────────────┬─────────────────┬──────────────┘
                         │ /api/understand  │ /api/rime-tts
            ┌────────────▼─────────────────▼──────────────┐
            │              NEXT.JS SERVER                 │
            │   /api/rime-tts  ← Rime HTTP-TTS (key here) │
            │   /api/understand ← optional LLM parser     │
            └─────────────────────────────────────────────┘
```

Key decision: **all credentials are server-side.** The client posts text to
`/api/rime-tts` and receives audio as base64; `RIME_API_KEY` never reaches the
browser.

## The hard problem: interruption and recovery

The runtime (`lib/conversation.ts`) treats every utterance as a **generation**
with a unique `turnId` + `generationId` and a cancellation token.

```
turn begins ──► intent parse ──► tool execute ──► Rime synth ──► playback
                          ▲            ▲            ▲            ▲
          stale fence 1   │   stale fence 2 │   stale fence 3 │  stale fence 4
```

At every async boundary the runtime re-checks whether this generation is still
the authoritative one:

- **fence 1** after intent parse — drop parse result, enter `CANCELLING`
- **fence 2** after tool execution — reject stale result, *never* speak it
- **fence 3** after synthesis returns — call `handles.stop()`, no playback
- **fence 4** after playback finished — never advance stale completion

Interruption anywhere in this chain is safe because each check is
`token !== current` or `stale === true`; the old generation can only resolve
into a *silent* `CANCELLING`/`RECOVERING` path.

### State machine

A pure reducer (`lib/state-machine.ts`) enforces legal transitions and is unit
tested with simulated event sequences. States:

```
IDLE → LISTENING → THINKING → TOOL_RUNNING → SPEAKING → COMPLETED
                     │ ▲          │  ▲           │  ▲
                     ▼ │          ▼  │           ▼  │
                   INTERRUPTING ──► RECOVERING ────────► (barge-in → LISTENING)
```

## Concurrency model

- `markTurnStale()` sets `stale = true` and synchronously stops the active audio
  source (a WebAudio `AudioBufferSourceNode.stop()`).
- `cancelToken` is a `Symbol` replaced on each new turn; every async continuation
  captures the token it started with and checks identity before speaking.
- No shared mutable audio queue: the single active source pointer is the only
  playback authority, so duplicate playback is structurally impossible.

## Tool execution

`lib/tools.ts` is a deterministic program engine (pure functions over the
session program). `applyIntent` returns `{ program, change }`, and `change` is
exactly the text handed to Rime — so the spoken answer always reflects the
latest applied program state. The demo control "tool delay" injects a
deterministic artificial delay for the stress scenario; it is surfaced in
telemetry (`delay.configured`, `tool.executed` duration) and never hidden.

## Intent parsing

- Default: deterministic local parser (`lib/intent.ts`) — one canonical path for
  the acceptance test, no external dependency.
- Optional: `/api/understand` (OpenAI-compatible) for free-form phrasing.
  Whichever path ran is reported in the evidence panel (`intent provider`).

## Telemetry and evaluation

`lib/telemetry.ts` is a tiny in-memory sink recording, per interruption:

- `interrupt.issued` timestamp
- interruption→audio-stop latency
- stale-suppression and recovery outcomes
- tool/synth/closure latencies with generation tags

The evidence panel renders these live. Reports in `RIME_EVIDENCE.md` cite only
these records (uncached) and state sample sizes.

## Why not a socket/streaming realtime stack

Hackathon judgment weights correctness, evidence, and demo clarity. A transport
does not win points by itself. We deliberately avoided a heavyweight socket or
LiveKit dependency: WebAudio + server proxy is enough to exercise the hard
problem end-to-end, keeps setup to `npm install`, and works offline-ish for
judges. If realtime transport were required, the `VoiceEngine` interface is the
drop-in seam for a streaming/WebSocket Rime engine or LiveKit Agents.