# Spotter

**A voice-native coaching copilot with an interruptible Rime voice pipeline.**

Spotter is a Rime Hackathon submission. It is *not* a chat-with-an-LLM toy. It is
a hands-free workflow for a strength coach whose hands are on the bar: Spotter
delivers the working set, the coach speaks a correction while Spotter is still
talking, and Spotter must stop immediately, discard the stale instruction
mid-flight, recompute the program, and speak **only** the corrected answer.

> **The voice-native test:** if all speech disappeared and the coach could simply
> click buttons, would this product remain the same? No. The coach's hands are
> on a loaded barbell; typing is impossible; interrupting Spotter mid-sentence is
> the whole point. Remove speech and the product collapses.

---

## 1. Product overview

Spotter reads, updates, and narrates a strength program as a live coaching
session. The coach speaks into a push-to-talk mic (or holds **Space**):

- `"what is next"` — Spotter reads the next movement.
- `"drop the deadlift to 200 kilos, 3 sets of 5"` — Spotter recomputes the block and speaks the adjustment.
- `"log a set of bench press"` — Spotter tracks completed sets and speaks the remaining workload.
- `"move to the next block"` — Spotter advances the program.

Spotter can be interrupted at any point — **while thinking, while running a tool
call, or mid-speech** — and it recovers from the latest instruction, never from
stale state.

## 2. Target user

Personal trainers and strength coaches during a live session, spotting a bar or
holding equipment, with eyes and hands unavailable.

## 3. Why voice is necessary

The coach's hands are on the bar and their eyes are on the lifter. Voice is the
only input/output channel that fits; interactive voice control (interruption,
rapid conversational correction) is exactly what a spotter does multiple times a
minute.

## 4. Hard voice problem

**Interruption and recovery under the double race.** The user interrupts while the
agent is (a) still speaking **and** (b) an in-flight tool call (program recompute)
has not yet resolved. The system must:

- fence and stop queued/active audio promptly
- invalidate the obsolete generation
- reject the stale tool result so it is *never* spoken
- keep the user's updated intent authoritative
- speak only the corrected, current answer

See [RIME_EVIDENCE.md](./RIME_EVIDENCE.md) for the acceptance test and measurements.

## 5. Architecture

```
Browser (Next.js app router)
├── /api/rime-tts            ← server proxy, RIME_API_KEY stays server-side
├── /api/understand          ← optional LLM intent parsing (falls back to local parser)
└── client runtime
    ├── ConversationRuntime  ← pipeline orchestrator + stale-fence semantics
    ├── VoiceEngine
    │   ├── RimePrimaryVoiceEngine     (default, judged path)
    │   └── OptionalFallbackVoiceEngine(browser speechSynthesis, explicit)
    ├── intent parsing       ← local deterministic parser (or /api/understand)
    ├── tools.ts             ← deterministic workout-program engine
    └── telemetry.ts         ← interruption/latency measurements
```

### Realtime flow

```
mic → STT → turn ID/generation ID → intent → tool execution → Rime TTS → WebAudio playback
                                      ↑ interruption barge-in fenced at every point
```

Every turn carries a unique `turnId` + `generationId`. When an input arrives
while a prior turn is active, the prior generation is fenced: audio stops via a
hard WebAudio source-stop, and its `synthesize`/tool promise resolves into a
`CANCELLING` path that can never reach `SPEAKING` again.

## 6. Rime integration

- **Primary engine:** `RimePrimaryVoiceEngine` (`lib/voice/rime.ts`) — model `v2.5`,
  speaker `amara`, `en-US`, WAV over HTTP-TTS through the server proxy.
- Credentials are server-side only (`RIME_API_KEY` in `.env.local`); the browser
  never sees a token.
- The active provider/model/voice/transport is shown in the gutter and the
  evidence panel on every turn.
- **Fallback:** `OptionalFallbackVoiceEngine` (browser `speechSynthesis`) exists
  for resilience only. Activation is **explicit** (the demo control "tts path"),
  always marked `FALLBACK AUDIO` in the UI, and recorded in telemetry. Rime is
  always the default judged path.

## 7. Technology stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Web Audio API for Rime playback and interruption
- Web Speech API (STT) with input-level metering
- Vitest for the acceptance state-machine tests
- No UI framework — a hand-written design system (see `app/globals.css`)

## 8. Local setup

```bash
npm install
cp .env.example .env.local
# set RIME_API_KEY=<your key>
npm run dev
# open http://localhost:3000
```

Speech recognition requires Chrome or Edge. Audio playback and mic require a
user gesture (tap "hold to talk" or hold **Space** first).

## 9. Environment variables

See [.env.example](./.env.example). All values are placeholders except the
`NEXT_PUBLIC_*` flags, which are safe to ship and default to `false`.

| Variable | Purpose |
| --- | --- |
| `RIME_API_KEY` | Rime credentials (server-side only) |
| `RIME_ENDPOINT` | optional override of the Rime HTTP-TTS endpoint |
| `RIME_MODEL` / `RIME_SPEAKER` | optional overrides (defaults `v2.5` / `amara`) |
| `OPENAI_API_KEY` | optional LLM intent parser provider |
| `OPENAI_BASE_URL` / `OPENAI_MODEL` | optional OpenAI-compatible overrides |
| `NEXT_PUBLIC_SHOW_EVAL_PANEL` | show evidence panel by default |
| `NEXT_PUBLIC_ENABLE_MIC` | allow mic at all |

## 10. Running the application

```bash
npm run dev      # development
npm run build    # production build
npm run start    # serve production build
```

## 11. Running tests

```bash
npm test                 # full suite
npm run test:acceptance  # the hard-voice acceptance test
```

The acceptance test drives deterministic event sequences (see
`tests/acceptance.test.ts`) and asserts that the stale response is never spoken
after a correction, stale tool results are rejected, and the corrected answer is
the only final output.

## 12. Running the evaluation (evidence)

1. Open the app. Enable the evidence panel (bottom of the right column).
2. Set **tool delay** to `1500 ms` (or `600 ms`) for a deterministic tool window.
3. Ask `"what is next"` — Spotter starts reading the next block.
4. Mid-speech, hold + release to interrupt with `"actually drop the deadlift to
   200 kilos, 3 sets of 5"`.
5. Observe: the obsolete line is struck-through in the turn log, audio stops, and
   the evidence panel records interruption→audio-stop latency, stale-response
   suppression, recovery outcome, and the raw interruption timings.

See [RIME_EVIDENCE.md](./RIME_EVIDENCE.md) for the scripted procedure.

## 13. Known limitations

- STT requires Chrome/Edge (Web Speech API). Firefox/Safari fall back to
  type-to-talk UI states gracefully, but mic capture is unavailable.
- Rime HTTP-TTS is a full-audio request, so barge-in fencing happens at audio
  delivery boundaries; a future streaming/WebSocket transport would reduce the
  boundary latency further.
- Intent parsing is deterministic-local unless `OPENAI_API_KEY` is configured;
  the AI path is disclosed in telemetry/UI and never assumed.
- No authentication — single-user local demo session, as expected for a
  hackathon submission.

## 14. Failure behavior

- **Rime 503 / no key:** `/api/rime-tts` returns an error; the UI enters an
  `ERROR` state with a clear message and reset. It never silently substitutes a
  different voice path. The fallback path is available via the explicit
  "tts path" control.
- **Network failure:** surfaced as an error state with retry/reset.
- **Unsupported input:** the local parser safely degrades to
  `"Which exercise should I adjust?"` style prompts rather than crashing.
- **Duplicate events:** the state machine rejects invalid transitions explicitly
  and suppresses duplicate `SPEECH_FINISHED` events (see `state-machine.ts`).

## 15. Demo flow

See [docs/demo-script.md](./docs/demo-script.md) (5-minute judge walkthrough with
timing).

## 16. Evidence methodology

All measurements come from the shipped system's telemetry (`lib/telemetry.ts`),
recorded with turn/generation IDs, cached/uncached not conflated, sample sizes
visible in the evidence panel. No numbers are invented; Reproduction is pinned to
the accepted test command (`npm run test:acceptance`).

## 17. Security considerations

- Secrets are server-side env vars only; `.env*` is git-ignored.
- The `rime-tts` proxy never returns the API key to the client.
- `next.config.ts` sets `X-Content-Type-Options: nosniff` and a strict
  `Referrer-Policy`.

## Repository layout

```
app/            pages, API routes, design system CSS
components/     Session, Orb, Transcript, ProgramView, EvalPanel
lib/            voice engines, state machine, telemetry, intent, tools, hook
tests/          state machine + acceptance tests
docs/           architecture and demo script
```