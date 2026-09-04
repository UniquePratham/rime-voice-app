# Demo script — 5 minutes

Goal: leave the judge able to repeat "voice-native coaching where interrupting
the voice is the whole point."

## Setup before judging

- Chrome or Edge, cam/screen sharing ready.
- `npm run dev` (or production `start`). `RIME_API_KEY` set server-side.
- Mic working; confirm the gutter shows `Rime v2.5 · amara`.
- Evidence panel open (right column, "evidence panel" disclosure).
- Reset session before starting.

## 0:00–0:30 — Who it's for

> "Spotter is for a strength coach spotting a loaded barbell. Hands on the bar,
> eyes on the lifter — the coach can't type. Everything here is driven by
> speech you can interrupt."

Narrate the two visible things: the *signal* (state orb) and the *program*
(the live clipboard). Point at the input bar: *"Hold Space, talk, release."*

## 0:30–1:30 — Normal end-to-end flow

> Hold **Space**: "what is the squat"
- Spotter speaks: squat 5×3 @ 180 kg RPE 9, rest 3 minutes.
> "log a set of the squat"
- Watch the clipboard: Squat completedSets 1→2.
- Coverage of value: Rime voice is producing the audible answer; the program
  visibly changes — voice is doing real work.

## 1:30–2:30 — The difficult feature (interruption + recovery)

- Set **tool delay** = `1500 ms` (deterministic stress window).
> Hold and say: "what is next"
- Spotter begins *reading the next block*.
> While it is still talking, hold and say: "actually drop the deadlift to 200
> kilos, 3 sets of 5"
- On release: old audio stops, the obsolete line is struck through in the turn
  log, and only the corrected answer is spoken. Program shows Deadlift
  220→200 kg, 5×3→3×5.
- Call out the evidence panel: interruption recorded, audio-stop latency, stale
  suppression.

## 2:30–3:30 — Stress/failure scenario

- Keep tool delay = `1500 ms`.
> Hold and ask: "move to the next block"
- Immediately while the tool is still spinning, interrupt again:
> "make the bench 4 sets of 3"
- If you want an in-your-face stress: set the **tts path** to fallback in the
  middle, watch it flip to `FALLBACK AUDIO` (explicit disclosure), then set it
  back to Rime.
- Also demo a real failure honestly: stop the dev server (or clear
  `RIME_API_KEY`) and speak once — show the explicit error + reset, no silent
  substitution. Restart the server.

## 3:30–4:15 — Measured behavior / evidence

Walk the evidence panel:

- interruptions measured, audio-stop latency, stale-response suppression
- stale tool results rejected
- tool/synth latencies, turn/generation IDs
- Rime config row (model/voice/language/transport) — prove Rime is the active
  judged path

> State clearly: "All numbers come from the running system's telemetry —
> uncached, sample size visible — reproducible with `npm run test:acceptance`."

## 4:15–5:00 — Architecture + why this matters

- 30-second visual: mic → STT → intent → tool → Rime → WebAudio, with a
  stale-fence at **every** async boundary.
- Rime's role: primary (default) spoken output, server-side key, active path
  shown on every turn.
- Why it matters: the wrong spoken answer is a training error delivered to an
  athlete mid-set; consistency after interruption is the product, not a feature.

## Fail-safe talking points

- "Rime is default; fallback is explicit and labeled, never silent."
- "We claim one hard problem — interruption/recovery under a double race — and
  we prove it, not seven problems superficially."
- "Not team chat TTS; the same product without voice does not exist."

## Post-demo checklist

- Evidence panel numbers left on screen during Q&A.
- README + RIME_EVIDENCE.md + docs/ARCHITECTURE.md committed.
- No secrets committed (`.env*` ignored; screenshots avoided).