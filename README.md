# Beet meal logger

Voice assistant that logs meals. You say what you ate; a web page shows the dishes with nutrition from `foods.json`.

Three things, by talking:

1. **Log** — “I had two rotis and a katori of dal for lunch.”
2. **Edit** — “Actually make that three rotis.”
3. **Delete** — “Remove the chai I logged this morning.”

Nothing else. No login, no diet plans.

---

## Run locally (empty machine)

### What to install

| Tool | Why | Notes |
|------|-----|--------|
| [Node.js](https://nodejs.org/) 20+ | Express + React | |
| [pnpm](https://pnpm.io/installation) | This repo uses it | `npm install -g pnpm` is fine |
| [Python](https://www.python.org/) 3.10–3.14 | LiveKit agent | 3.13 works here |
| [uv](https://docs.astral.sh/uv/) | Python deps | `powershell -ExecutionPolicy Bypass -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| [Git](https://git-scm.com/) | Clone | |
| [MongoDB](https://www.mongodb.com/docs/manual/installation/) or [Atlas](https://www.mongodb.com/atlas) free | Persist meals | Local `mongodb://127.0.0.1:27017` or an Atlas URI |
| [LiveKit Cloud](https://cloud.livekit.io) account | Rooms + Inference (STT/LLM/TTS) | Free, no card |
| [LiveKit CLI](https://docs.livekit.io/reference/developer-tools/livekit-cli/#setup) | `lk agent dev` | Windows: `winget install LiveKit.LiveKitCLI` |
| Chrome (or similar) + a microphone | Talk button | |

After installing the CLI, close the terminal, open a new one, then:

```bash
lk cloud auth
```

Link the LiveKit project. Copy **URL**, **API Key**, and **API Secret** from project Settings → Keys.

### Clone and env files

```bash
git clone <this-repo>
cd Assistant
```

**`Backend/.env`** (copy from `Backend/.env.example`):

```
MONGO_URI=mongodb://127.0.0.1:27017/beet
PORT=3001
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

**`voice-agent/.env.local`** (copy from `voice-agent/.env.example`):

```
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
API_BASE_URL=http://127.0.0.1:3001
```

Use the **same** three LiveKit values in both files. `API_BASE_URL` is where the Python agent sends log/edit/delete. For a fully local run that must be your Express process, not a random host.

**Frontend proxy.** `Frontend/vite.config.ts` currently forwards `/api` to a deployed backend. For a machine that should talk only to local Express, change it to:

```ts
"/api": "http://127.0.0.1:3001"
```

If you leave the deployed URL, the page will hit that API instead of `Backend/` on your laptop.

### Install deps

```bash
cd Backend
pnpm install

cd ../Frontend
pnpm install

cd ../voice-agent
uv sync
```

### Three terminals

Mongo must already be running (local service or Atlas).

**1 — API**

```bash
cd Backend
pnpm dev
```

You should see it listening (default `http://localhost:3001`).

**2 — voice worker (needed for Talk on the page)**

```bash
cd voice-agent
lk agent dev
```

This joins **real LiveKit Cloud rooms**. `lk agent console` is a fake local room; use `--text` there only to type. Browser Talk needs `dev`.

**3 — page**

```bash
cd Frontend
pnpm dev
```

Open the Vite URL (usually `http://localhost:5173`). Click **Talk**, allow the mic, say what you ate. The list polls Mongo every 2 seconds.

### Optional: type to the agent (no mic)

With the backend up:

```bash
cd voice-agent
lk agent console --text
```

Type the three assignment sentences. The page still updates if it is pointed at the same API.

### Agent tests

Needs LiveKit keys in `voice-agent/.env.local` (they call Inference).

```bash
cd voice-agent
uv run pytest tests/test_agent.py -q
```

There are no Express/Jest tests yet (see below).

---

## How it is put together

Three processes, one database of truth.

```
Browser (React)
  ├─ GET /api/meals every 2s          → Express → Mongo
  └─ Talk: POST /api/livekit/token    → JWT
       └─ WebRTC → LiveKit Cloud room
            └─ Python worker (agent_name: meal-logger)
                 └─ tools → HTTP → same Express API → Mongo
```

The Python process is not a second store. It is a talking client of Express. Postman can log a meal the same way.

### Pieces

| Path | Role |
|------|------|
| `Backend/data/foods.json` | Beet catalog. Macros **per 100g**. Units are `{ name, grams }`. |
| `Backend/catalog.ts` | Search + `resolveItem`: unknown food / illegal unit → 400. Calories are computed here, never taken from the client or the LLM. |
| `Backend/models/Meal.ts` | One sitting (lunch, …) with nested `items[]`. Each item has `itemId` so edit/delete can target one dish. Macros are **snapshotted** on the item. |
| `Backend/routes/meals.ts` | GET / POST / PATCH item / DELETE item / DELETE meal. Duplicate log and no-op edit return `unchanged` and skip the write. |
| `Backend/routes/livekit.ts` | Mints a 15-minute JWT. Dispatches agent `meal-logger`. Secret never goes to the browser. |
| `voice-agent/src/agent.py` | LiveKit Agents: STT → Gemma → tools → TTS, all via **LiveKit Inference** (one key). |
| `voice-agent/src/api.py` | `httpx` wrapper around `/api/foods` and `/api/meals`. |
| `Frontend/src/App.tsx` | One page. Talk / Disconnect. Meal list. |

Worked nutrition example (from the real JSON): 2 rotis → `2 × 40g = 80g` → `297 kcal/100g × 0.8 = 237.6 kcal`.

## Incomplete, broken, or I’d do differently

Straight list.

**Broken / rough**

- **Terminal voice (`lk agent console`).** While testing locally I hit this: after the greeting the agent just sat there listening, no tools, nothing. I looked into it and console mode uses a fake local room, not a real LiveKit Cloud room — that is probably why the mic path died. I did not go much deeper on Windows audio. Instead I switched to `lk agent console --text` to check if tool calling was actually fine. It was. Then I used Talk in the browser with `lk agent dev` (real Cloud room) and that is the path that works. I would demo that, not the terminal mic.
- **Frontend `/api` proxy** in this repo may still point at a hosted backend. If you want everything on your laptop, set it to `http://127.0.0.1:3001` (see setup above).
- **No Express tests.** I tested the API by hand and through the agent. I would add real tests for catalog math and the write routes if I had more time.

**What I’d do with more time**

- I thought about WebSockets so the page updates instantly, but I have not used them enough to want that as the only live path on a deadline. I did not want extra moving parts and bugs to chase. Polling `/api/meals` every 2s is enough here: the agent writes Mongo, the page reads Mongo. Later I would add a small push (SSE or LiveKit data) and poll less.
- Same meal the next day can still count as a duplicate, because the check only looks at the latest meal of that type, not “today”. I would fix that with day/date on the query. I only remembered this after the rest of the app was working.
- One more agent test for “already 3 rotis” so it does not pretend it updated.

I would **not** add diet plans, photo logging, or a prettier UI. The brief asked for three features done properly.

First time building a LiveKit voice agent. Debugging this (console vs Talk, tools vs the page) taught me more than the random projects. I actually enjoyed it.