# Setup Guide — Spotter

Complete guide to run, test, and deploy the **Spotter** Rime Hackathon submission.

---

## Prerequisites

| Tool | Version | Purpose |
| --- | --- | --- |
| Node.js | 22+ | Runtime |
| npm | 10+ | Dependency management |
| Docker | 24+ | Containerized deployment (optional) |
| Chrome / Edge | Latest | Browser with Web Speech API (required for mic) |

## 1. Get Your Rime API Key

1. Go to [https://rime.ai](https://rime.ai) and create an account or log in.
2. Navigate to the API Keys section in your dashboard.
3. Generate a new API key — copy it; you will need it in step 3 below.

> **Important:** The API key is server-side only. It is never exposed to the browser.
> Spotter proxies all Rime requests through `/api/rime-tts`.

## 2. Clone / Extract the Repository

```bash
# If from a zip file:
unzip spotter.zip
cd rime-voice-app

# If from git:
git clone <repo-url> && cd rime-voice-app
```

## 3. Configure Environment Variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

```dotenv
# REQUIRED — paste your Rime API key here
RIME_API_KEY=your_rime_api_key_here

# OPTIONAL — override Rime endpoint/model/speaker (defaults are production-ready)
# RIME_ENDPOINT=https://users.rime.ai/v1/rime-tts
# RIME_MODEL=mistv2
# RIME_SPEAKER=astra

# OPTIONAL — enable LLM intent parsing (otherwise uses local deterministic parser)
# OPENAI_API_KEY=your_openai_key_here
# OPENAI_BASE_URL=https://api.openai.com/v1
# OPENAI_MODEL=gpt-4o-mini

# OPTIONAL — public flags
# NEXT_PUBLIC_SHOW_EVAL_PANEL=false
# NEXT_PUBLIC_ENABLE_MIC=true
```

| Variable | Required | Description |
| --- | --- | --- |
| `RIME_API_KEY` | **Yes** | Your Rime API key. Server-side only. |
| `RIME_ENDPOINT` | No | Override the Rime HTTP-TTS endpoint. Default: `https://users.rime.ai/v1/rime-tts` |
| `RIME_MODEL` | No | Override Rime model. Default: `mistv2` |
| `RIME_SPEAKER` | No | Override Rime voice. Default: `astra` |
| `OPENAI_API_KEY` | No | Enables LLM-based intent parsing. If absent, the local deterministic parser is used. |
| `OPENAI_BASE_URL` | No | OpenAI-compatible API base. Default: `https://api.openai.com/v1` |
| `OPENAI_MODEL` | No | Model name. Default: `gpt-4o-mini` |
| `NEXT_PUBLIC_SHOW_EVAL_PANEL` | No | Show the evidence/eval panel on load. Default: `false` |
| `NEXT_PUBLIC_ENABLE_MIC` | No | Enable microphone input. Default: `true` |

---

## 4. Local Development (without Docker)

```bash
npm install
npm run dev
# Open http://localhost:3000 in Chrome/Edge
```

### Run Tests

```bash
npm test                  # full suite (11 tests)
npm run test:acceptance   # hard-voice acceptance tests only
```

### Typecheck & Lint

```bash
npm run typecheck
npm run lint
```

### Production Build (local)

```bash
npm run build
npm run start
```

---

## 5. Docker Deployment

### Option A: Docker Compose (recommended)

```bash
# 1. Make sure .env.local exists with your RIME_API_KEY
cp .env.example .env.local
# Edit .env.local — set RIME_API_KEY=your_key

# 2. Build and run
docker compose up --build

# 3. Open http://localhost:3000 in Chrome/Edge
```

To stop:
```bash
docker compose down
```

### Option B: Docker CLI

```bash
# Build the image
docker build -t spotter:latest .

# Run with env vars
docker run -p 3000:3000 \
  -e RIME_API_KEY=your_rime_api_key_here \
  -e NODE_ENV=production \
  spotter:latest

# Or pass all vars from .env.local
docker run -p 3000:3000 --env-file .env.local spotter:latest
```

---

## 6. Using the Application

### Basic Flow

1. Open `http://localhost:3000` in **Chrome** or **Edge**.
2. **Hold Space** (or hold the on-screen button) and speak a command.
3. Release to submit.
4. Spotter processes the command and speaks the response via Rime TTS.

### Voice Commands

| Command | Action |
| --- | --- |
| `"what is next"` | Reads the next movement in the program |
| `"drop the deadlift to 200 kilos, 3 sets of 5"` | Adjusts exercise parameters |
| `"log a set of bench press"` | Logs a completed set |
| `"move to the next block"` | Advances to the next training block |

### Testing the Hard Voice Problem (Interruption & Recovery)

1. Open the **evidence panel** (bottom of the right column).
2. Set **tool delay** to `1500 ms` in demo controls.
3. Hold Space → say `"what is next"` → release.
4. While Spotter is speaking, **hold Space again** → say `"actually drop the deadlift to 200 kilos, 3 sets of 5"` → release.
5. Observe:
   - The old audio stops immediately
   - The stale line is struck-through in the transcript
   - The evidence panel shows interruption metrics
   - Only the corrected answer is spoken

---

## 7. Browser Requirements

| Feature | Chrome/Edge | Firefox | Safari |
| --- | --- | --- | --- |
| Voice input (STT) | ✅ | ❌ | ❌ |
| Audio playback (Rime TTS) | ✅ | ✅ | ✅ |
| Full demo | ✅ | Partial (no mic) | Partial (no mic) |

> Speech recognition requires a **secure context** — `localhost` or `https`.
> If accessing from a network IP (e.g., `192.168.x.x`), the mic will be blocked.

---

## 8. Troubleshooting

| Problem | Cause | Fix |
| --- | --- | --- |
| `503 NO_KEY` in the UI | `RIME_API_KEY` not set | Set it in `.env.local` and restart |
| Microphone blocked | Insecure context | Use `localhost` or `https`, not a raw IP |
| No audio plays | Browser autoplay policy | Click the talk button once first (user gesture required) |
| Tests fail | Missing deps | Run `npm install` first |
| Docker build fails | Old Node image | Ensure Docker pulls `node:22-alpine` |

---

## 9. Project Structure

```
rime-voice-app/
├── app/                    # Next.js pages, API routes, CSS
│   ├── api/
│   │   ├── rime-tts/       # Server-side Rime proxy (RIME_API_KEY stays here)
│   │   └── understand/     # Optional LLM intent parsing
│   ├── globals.css          # Design system
│   ├── layout.tsx
│   └── page.tsx
├── components/             # UI components
│   ├── Session.tsx          # Main session controller
│   ├── Orb.tsx              # State visualization orb
│   ├── Transcript.tsx       # Turn log
│   ├── ProgramView.tsx      # Live workout program
│   └── EvalPanel.tsx        # Evidence/telemetry panel
├── lib/                    # Core logic
│   ├── conversation.ts      # ConversationRuntime (pipeline orchestrator)
│   ├── state-machine.ts     # Interruptible voice state machine
│   ├── intent.ts            # Deterministic + AI intent parser
│   ├── tools.ts             # Workout program engine
│   ├── telemetry.ts         # Measurement/logging
│   ├── stt.ts               # Speech recognition wrapper
│   ├── use-session.ts       # React hook binding
│   ├── types.ts
│   └── voice/
│       ├── engine.ts        # VoiceEngine abstraction
│       ├── rime.ts          # RimePrimaryVoiceEngine
│       └── fallback.ts      # OptionalFallbackVoiceEngine
├── tests/                  # Vitest test suite
│   ├── acceptance.test.ts   # Hard-voice acceptance tests
│   ├── state-machine.test.ts
│   └── helpers.ts
├── docs/
│   ├── ARCHITECTURE.md
│   └── demo-script.md
├── .env.example            # Environment template
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # One-command deployment
├── RIME_EVIDENCE.md        # Hard voice claim + measurements
└── README.md
```

---

## 10. Creating a Submission Zip

```bash
# From the rime-voice-app directory:
# Make sure node_modules, .next, .env.local are excluded
cd ..
zip -r spotter-submission.zip rime-voice-app/ \
  -x "rime-voice-app/node_modules/*" \
  -x "rime-voice-app/.next/*" \
  -x "rime-voice-app/.env.local" \
  -x "rime-voice-app/.env.*.local"
```

Or on Windows PowerShell:
```powershell
Compress-Archive -Path rime-voice-app -DestinationPath spotter-submission.zip
# Note: manually exclude node_modules and .next first, or delete them before zipping
```

The zip should include: all source code, Dockerfile, docker-compose.yml, .env.example,
README.md, RIME_EVIDENCE.md, SETUP.md, tests/, and docs/.
