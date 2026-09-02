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

### Decisions worth calling out

- **Python agent + MERN app.** The PDF asked for MERN and allowed whatever LiveKit supports best. Agents + the eval harness are Python-first.
- **Server owns nutrition.** `foods.json` is the source of truth. Write bodies only send `foodId`, `quantity`, `unit`.
- **Nested items, not one row per dish.** One utterance is one meal; edit/delete are per line (`itemId`).
- **Snapshot macros, recompute on edit.** History should not drift if the JSON changes; a quantity change should use the current catalog.
- **No auth.** `userId` is always `demo`. Login was not in the feature set.
- **Polling every 2s.** Voice writes Mongo on another path; the tab is not notified. Polling keeps Talk, a text console, and a refresh in sync. A socket would be nicer; this is correct and small.
- **Skip Cloud noise cancellation in `console`.** That plugin needs a real LiveKit room; it crashed the job in the local mock room.
- **No-op guard.** “Make it three rotis” when it is already three does not write, and the agent is instructed to say it is already logged.
- **`lk agent console` voice on Windows** was unreliable (greeting worked, speech often never became a transcript). **Talk in the browser + `lk agent dev`** is the path that works. Text console (`--text`) is fine for debugging tools.

---

## Incomplete, broken, or I’d do differently

Straight list.

**Broken / rough**

- **Terminal voice (`lk agent console` without `--text`)** on this Windows machine: the agent greets, then often never hears the next utterance. Not the meal API — STT/turn-taking on the fake console room. I would not demo that path.
- **Frontend `/api` proxy** in this checkout points at a hosted backend. A reviewer starting from an empty machine who does not change `vite.config.ts` will not hit their local Express. I should have left localhost as the default and documented the hosted URL separately.
- **Backend `pnpm test`** is still the placeholder (`echo` and exit 1). Catalog math, 400s for unknown food / bad unit, no-op edit, and duplicate log are the interesting contract and they are not automated on the Node side.
- **Duplicate detection** is “same food + unit + quantity on the *latest* meal of that type,” not “same calendar day.” Logging 2 rotis for lunch tomorrow could be treated as a duplicate of yesterday’s lunch. I’d key it by `userId + mealType + local date`.
- **Search `normalize`** strips a trailing `s` so “rotis” hits `roti`. That can also mangle words (e.g. “glass”). Good enough for this catalog; I’d use aliases-only matching.

**Incomplete (on purpose, or time)**

- No signup. Fine for the brief; I would still not add it without being asked.
- No push of meal events over LiveKit data channels. Polling works; with more time I’d emit a small “meals-changed” after each successful tool so the page updates immediately and we could poll more slowly.
- No mute control on the page (Talk / Disconnect only). Easy add; not needed to prove the loop.
- Agent tests mock HTTP and need LiveKit Inference keys. They cover log / edit / delete / out-of-catalog. They do not cover the no-op “already 3 rotis” path (added later).
- `foods.json` must stay Beet’s file. If you swap the schema, `catalog.ts` has to follow.

**What I’d do with more time**

- Express tests with `mongodb-memory-server` (or Atlas in CI) for `resolveItem` and the write routes — that is the nutrition contract.
- One more agent eval: already-logged quantity → no `update_item` / `unchanged: true` spoken.
- Date-scoped meals and a clearer “today” on the page (`eatenAt` vs “whatever is in the DB”).
- Default Vite proxy to `http://127.0.0.1:3001`.
- Slightly less aggressive catalog search.

I would **not** add diet plans, photo logging, or a prettier UI. The brief asked for three features done properly.

---

## Extra

A longer beginner walkthrough (MERN → LiveKit, line-level notes) is in [`How_This_Project_Works.pdf`](./How_This_Project_Works.pdf).
