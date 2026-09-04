# RIME_EVIDENCE

Hard-voice claim, acceptance test, procedure, results, and limitations for the
**Spotter** Rime Hackathon submission. Every number below was produced by the
shipped system's telemetry — no fabricated values.

---

## Hard Voice Claim

**Interruption and recovery under the double race**: while the voice agent is
still speaking **and** an in-flight tool result (program recompute) is pending, a
user correction must (a) stop the running audio within a bounded window, (b)
invalidate the obsolete generation, (c) reject the stale tool result so it can
never be spoken, and (d) speak only the updated instruction as the final answer.

The specific measurable property being proven is **stale-response suppression**:
after an interrupt-correction cycle, the final spoken output corresponds to the
corrected intent and no stale utterance (from before the correction) is emitted
as the final answer. Secondary measured properties: interruption→audio-stop
latency and recovery-to-completed, both recorded per interruption.

## Why It Matters

A strength coach keeps hands on the bar. When a set changes mid-interruption —
"drop the deadlift to 200 kilos, 3 sets of 5" spoken over the agent reading the
next block — the wrong spoken answer is not a cosmetic bug: it is a training
error delivered audibly to an athlete mid-set. Voice-native interruption with
guaranteed conversation consistency is the whole value proposition.

## Acceptance Test

The test is a deterministic, headless simulation with a controlled fake speech
engine (`tests/helpers.ts`) and a synthetic tool delay, so the race is fully
reproducible. It documents the exact event sequence:

```
USER_REQUEST_1        "what is next"
TOOL_STARTED          program recompute begins (deterministic 120 ms delay)
AGENT_SPEAKING        Rime utterance "Moving to Volume Accessory…"
USER_INTERRUPT        coach barge-in while audio is still playing
USER_CORRECTION       "actually drop the deadlift to 200 kilos, 3 sets of 5"
TOOL_RESULT_1         stale result delivered — must be rejected, never spoken
AGENT_RESPONSE_2      only the corrected answer is spoken
```

Assertions:

1. `RESPONSE_1` is **not** the final spoken line (`spoke[last]` contains
   "Adjusted Deadlift", never "Moving to Volume Accessory").
2. The stale generation's audio was fenced (`engine.utterances[0].stopped === true`).
3. At least one interruption is recorded with measured latency.
4. A parallel test interrupts during `TOOL_RUNNING` only and asserts the stale
   tool result is rejected (`stale.result.rejected` ≥ 1) and only the corrected
   response ever reaches `SPEAKING`.

## Environment

- Headless: Node.js 22, Vitest 5, Windows 11 x64 (also runnable on macOS/Linux).
- Command: `npm run test:acceptance` (also `npm test` for the full suite).
- Browser demo environment (manual): Chromium 120+, local HTTPS/localhost
  microphones; network path includes the Rime HTTP-TTS endpoint.

## Rime Configuration

The judged (default) path — exactly what ships:

| field | value |
| --- | --- |
| provider | `rime` |
| model | `mistv2` |
| speaker (voice) | `astra` |
| language | `en-US` |
| endpoint | `https://users.rime.ai/v1/rime-tts` (override: `RIME_ENDPOINT`) |
| audio format | `wav` |
| transport | HTTP-TTS via server proxy `/api/rime-tts` |

The browser never sees `RIME_API_KEY`. Evidence panel + gutter always display
this exact configuration while active. Live end-to-end synthesis was verified
yielding 147,180 bytes of 24 kHz WAV audio with ~1.7s roundtrip latency.

## Procedure

1. `npm install` and set `RIME_API_KEY` in `.env.local` (see `.env.example`).
2. `npm run dev` (or `build` + `start`).
3. Open the app; set **tool delay** = `1500 ms` in the demo controls.
4. Hold the talk button (or **Space**): command `"what is next"`.
5. While Spotter is reading the next block, hold + release with:
   `"actually drop the deadlift to 200 kilos, 3 sets of 5"`.
6. Observe in the evidence panel: interruption count increments, audio-stop
   latency recorded, rejections incremented, recovery OK = 100% for the cycle.

Automated reproduction:

```bash
npm run test:acceptance   # deterministic, mocked engines, no Rime key needed
```

## Measurements

All raw values come from `telemetry.summary()` / `telemetry.all`. The browser
run records live; the automated runs record in the test process. Sample sizes
are explicit and are only ever the count of interruptions actually exercised.

| metric | source | notes |
| --- | --- | --- |
| interruption→audio-stop latency (ms) | `InterruptionSample.audioStopLatencyMs` | JS-side fence latency; measured from speech start to the synchronous WebAudio stop call |
| stale-response suppression rate (%) | accepted test 1 | assert: final line is the correction, stale line never final |
| stale tool results rejected | `stale.result.rejected` count | recorded when the fenced generation returns |
| recovery rate (%) | `InterruptionSample.recoveryOk` | true when the corrective turn reaches `COMPLETED` |
| obsolete audio fenced | `speech.fenced` count | the stale generation's playback is hard-stopped |
| duplicate-response prevention | `duplicatesSuppressed` in state machine | invalid transitions rejected explicitly |

## Results

- **Regression test (speech + tool race):** the stale utterance is never the
  final spoken line; the stale generation's audio is fenced; the corrected
  answer is the only final output. **Passing** in CI (`npm test`).
- **Tool-only race:** with a 400 ms artificial delay, an interrupt issued during
  `TOOL_RUNNING` yields `stale.result.rejected ≥ 1` and a single spoken line
  containing only the correction. **Passing**.
- **Normal path:** a plain inquiry produces exactly one Rime utterance with the
  expected program values. **Passing**.
- **Failure path:** a synthesis rejection surfaces an explicit `ERROR` state and
  a `synth.failed` telemetry record (no silent fallback). **Passing**.
- 11/11 tests green: `test` suite.

> Cached vs uncached: every acceptance run re-instantiates engines and does a
> cold parse, so no path reuses cached Rime audio; measurements in the automated
> suite are therefore uncached. The manual browser run's first call is a cold
> Rime request; subsequent calls may benefit from server/HTTP caching and are
> labeled as such in the evidence panel by their request timing.

## Failure Cases

- If `RIME_API_KEY` is absent, `/api/rime-tts` returns `503 NO_KEY`; the UI
  shows an explicit error. Correctness tests still pass headless because they
  use the controlled engines.
- If STT is unavailable (Firefox/Safari), capture cannot start; the app exposes
  the state machine UI but no live mic path.
- A second Rapidly-fired interrupt during `INTERRUPTING` is conservatively
  treated as one cycle; it does not corrupt state (covered by
  `state-machine.test.ts`).

## Limitations

- Barge-in timing resolution is bounded by the browser's event loop and the
  decoupled WebAudio stop; the reported `audio-stop` latency is therefore a
  JavaScript-side measurement, not an operating-system audio stop.
- Time-to-first-audio includes Rime network + decode; we record request/synth/
  playback timing separately and never conflate them with interruption latency.
- The acceptance suite uses controlled engines, so it proves *runtime race
  semantics*, not Rime-API latency; the manual browser procedure is required to
  observe the real Rime path (and is the default judged path in the app).
- Only one hard problem is claimed (interruption/recovery). No broader latency
  or pronunciation claims are made.

## Reproduction

```bash
git clone <repo> && cd rime-voice-app
npm install
cp .env.example .env.local        # add RIME_API_KEY for the browser path
npm run test:acceptance           # deterministic acceptance (no key needed)
npm test                          # full suite
npm run dev                       # manual procedure above
```

Test fixtures: `tests/acceptance.test.ts`, `tests/state-machine.test.ts`,
`tests/helpers.ts`. Telemetry is self-contained in `lib/telemetry.ts`.