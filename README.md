# tasawwur · تصور

**To imagine, and to picture — the same word in Arabic.** Describe something; get the
picture back.

tasawwur generates narrated short videos from a topic or a script. It writes the
narration, finds matching stock footage, speaks it aloud, times the captions to the
voice, and renders a finished MP4 — using only free services.

> **Status: early.** The GUI and service layer are working. Video rendering is not
> implemented yet and is currently delegated to an external engine over HTTP. See
> [Roadmap](#roadmap) for exactly what does and does not work today.

---

## Why this exists

Making a short video should not cost anything, and it should not require a studio.
Everything tasawwur depends on is free: Microsoft Edge's speech synthesis, Pixabay and
Pexels for footage, ffmpeg for rendering. No API keys, no per-minute billing, no
account. Point it at an idea and it hands back an MP4.

It is built to be pleasant to use and simple to read — one language end to end,
TypeScript everywhere, with the interface treated as part of the product rather than an
afterthought.

## What makes a good video

This turned out to matter far more than any render setting, so it belongs near the top.

Three test videos were generated while building this. Two were poor and one was good,
and **the pipeline was flawless in all three** — correct durations, perfect audio sync,
zero warnings. The difference was entirely in the search keywords.

| Subject | Result |
|---|---|
| Cats | AI-generated kitten renders, one unrelated Milky Way clip, a tiger |
| Office focus | Technically clean, but 3 of 8 clips were mosque footage |
| **Water / rivers** | **8 clips, 8 different creators, nothing off-topic** |

The failure mode is always the same: **one creator dominates a keyword**. Stock libraries
let a single contributor upload dozens of near-identical clips, so a term that returns
"11 results" can be eleven versions of one shot. Deduplicating by *file* — which the
engine does — cannot see this.

The fix is to **measure before writing** — query the library, count results *and*
distinct creators, and reject any term where one creator supplies more than half:

```
term                  clips  creators   verdict
waterfall                14        12   use
sunset sky               13         9   use
focus work               11         1   reject - all one creator
quiet room reading        7         3   reject - religious study footage
office desk               0         0   reject - no vertical coverage
```

A probe helper is planned for `@tasawwur/core`; today this is done by hand before
writing the script.

Terms with deep, *creator-diverse* vertical coverage: `waterfall` (14 clips / 12
creators), `sunset sky` (13/9), `forest trees` (7/7), `rain window` (5/5). Terms that
return **nothing** in 9:16: `office desk`, `laptop work`, `paperwork`, `alarm clock`.

Write the script to fit terms that pass the probe, not the other way round.

## Quick start

**Requirements:** Node 20+, pnpm 10+, ffmpeg, and — until the renderer lands — a
rendering engine reachable over HTTP (see [Rendering](#rendering)).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then edit it
pnpm dev                                        # http://localhost:3000
```

Then open **Settings** and paste a [Pixabay API key](https://pixabay.com/api/docs/) —
free, instant, no card. That one key powers both footage search and the term checker.

### Speech on your own machine (optional)

Narration can run locally, with no account and no network after the first
download:

```bash
npx pnpm@12 install          # installs the optional kokoro-js
```

This pulls the ONNX runtime (~400MB) and fetches a 97MB model on first use,
which is why it is optional rather than required.

It needs **pnpm 12 or newer**: pnpm 10 runs out of memory extracting the
runtime. Run it through `npx` as above rather than pinning `packageManager` —
corepack on Node 24 cannot launch pnpm 12, and pinning it breaks every script in
the repo.

Note that Kokoro reports no word timings, so captions are estimated from word
length. Good for sentence captions; not accurate enough for word-by-word ones.

### Rendering

Until the renderer is built, tasawwur delegates rendering to an external engine over
HTTP. Any service implementing the same REST contract will work — point `ENGINE_URL` at
it. The contract is defined in [`packages/schema`](./packages/schema/src/api.ts).

### Environment

| Variable | Purpose |
|---|---|
| `ENGINE_URL` | Where the generation engine listens. Default `http://127.0.0.1:8080/api/v1`. |
| `ENGINE_FONTS_DIR` | The engine's `resource/fonts`. Temporary — it only loads fonts from its own directory. Disappears when the renderer is ported. |
| `TASAWWUR_SETTINGS` | Override the settings file location. Optional. |

Settings live in `~/Library/Application Support/tasawwur/settings.json` (macOS),
`%LOCALAPPDATA%` (Windows), or `$XDG_CONFIG_HOME` (Linux) — deliberately **not** the
engine's `config.toml`, which is rewritten wholesale whenever its own UI saves.

## Architecture

```
apps/web            Next.js — GUI, API routes, engine proxy
packages/core       service implementations (voices, fonts, settings)
packages/api-client typed client for the generation API
packages/schema     zod contracts shared by everything
```

### The proxy is the migration seam

The browser only ever talks to same-origin `/api/engine/*`, which forwards to the engine.
That removes CORS and keeps the engine URL out of the client bundle — but the real reason
is structural: **as each service is reimplemented in TypeScript, its route stops being
proxied and becomes a real handler.** The GUI never changes. The final step is deleting
the last proxy branch.

Four routes are already implemented here and never leave the process: `/api/voices` fetches
Microsoft's public Edge TTS catalogue directly, `/api/probe` searches stock footage and
scores search terms, `/api/settings` owns its own store, and
`/api/tasks/[id]/events` streams task progress over SSE.

### The pipeline

```
subject ──LLM──> script ──LLM──> keywords ──> stock search ──> download
                    │                                              │
                    └──TTS──> narration + word-boundary timeline    │
                                       │                            │
                                  captions                          │
                                       └──────> ffmpeg render <─────┘
```

The word-boundary timeline returned by Edge TTS is the keystone: it makes
word-level captions free and perfectly synced, with nothing to transcribe afterwards.

## Development

```bash
pnpm dev         # GUI at :3000
pnpm test        # contract + integration tests
pnpm typecheck   # all packages
pnpm build       # production build
```

Integration tests drive a real engine and real TTS. They **skip themselves** when nothing
is listening, so the suite stays green without a backend.

### Contract tests are not optional

`packages/schema` is the agreement with the engine. One test asserts the exact field
count:

```ts
expect(Object.keys(VideoParams.shape)).toHaveLength(40);
```

If that fails, the GUI and the engine have drifted. Fix the drift — don't relax the test.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| Foundation | Monorepo, schema, typed contract | **done** |
| Interface | GUI, voices, fonts, settings | **in progress** |
| Services | Script and keyword generation, stock search, speech | not started |
| Renderer | ffmpeg filter graphs, captions, mixing | not started |
| Standalone | No external engine required | not started |

The one real constraint is **process lifetime**. Rendering is minutes of CPU and
gigabytes of temp files, so it needs a long-running worker — it cannot run in a
serverless function. Everything else is ordinary Node work: ffmpeg does the heavy
lifting and is driven by filter graphs.

See [docs/DECISIONS.md](./docs/DECISIONS.md) for why services here are written
from protocols rather than from other implementations.

### Rendering details that are easy to get wrong

Measured while testing output, and worth getting right the first time:

- A **+0.1s** duration margin — frame rounding otherwise leaves a black tail.
- BT.709 conversion **and** tagging, or colours shift in players and on YouTube.
- Codec probing with runtime fallback to `libx264` when a hardware encoder fails.
- Audio duration measured from the **written file**, not the last word boundary. Edge TTS
  leaves roughly 0.88s of tail, which is 19% of a short clip.
- Subtitle font paths confined to the fonts directory (path-traversal guard).

## Known rough edges

- Rendering is not implemented yet; an external engine is required.
- No task history — closing the tab loses the UI's view of a render, though the file
  still lands on disk.
- Engine task state is in-memory, so it does not survive a restart.

## Licence

MIT — see [LICENSE](./LICENSE).

Generated videos use third-party stock footage and synthesised speech. Check the terms of
Pixabay, Pexels, and Microsoft Edge TTS before publishing at volume or monetising.
