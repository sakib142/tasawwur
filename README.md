# tasawwur · تصور

**To imagine, and to picture — the same word in Arabic.** Describe something; get the
picture back.

tasawwur generates narrated short videos from a topic or a script. It writes the
narration, finds matching stock footage, speaks it aloud, times the captions to the
voice, and renders a finished MP4 — using only free services.

> **Status: early.** The TypeScript GUI and service layer are working. Rendering is
> still delegated to the Python engine it is being migrated from. See
> [Migration](#migration) for exactly what is and is not ported yet.

---

## Why this exists

This began as a front-end for
[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo), whose pipeline is
genuinely good: correct audio/video sync, careful codec fallback, hard-won handling of
4K sources and odd aspect ratios. What it lacked was an interface worth using — 8,477
lines of Streamlit in a single file.

Rather than wrap that, tasawwur is porting the whole pipeline to TypeScript so there is
one language, one toolchain, and a UI that can actually be designed. The original is MIT
licensed and its copyright is preserved in [LICENSE](./LICENSE).

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

**Requirements:** Node 20+, pnpm 10+, ffmpeg, and (for now) the Python engine.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then edit it
pnpm dev                                        # http://localhost:3000
```

The engine must be running separately until the renderer is ported:

```bash
# in the MoneyPrinterTurbo checkout
python -m uvicorn app.asgi:app --host 127.0.0.1 --port 8080
```

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

Two routes are already native and never touch Python: `/api/voices` fetches Microsoft's
public Edge TTS catalogue directly, and `/api/settings` owns its own store.

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

## Migration

| Stage | Scope | Status |
|---|---|---|
| 0 | Monorepo, schema, contract | **done** |
| 1 | GUI against the engine; voices, fonts, settings native | **in progress** |
| 2 | Port `llm`, `material`, `voice` to TypeScript | not started |
| 3 | Port the renderer to ffmpeg filter graphs | not started |
| 4 | Delete Python | not started |

**Nothing requires Python.** Every dependency has a Node equivalent — the renderer uses
only 8 moviepy symbols, and the final concat already shells out to ffmpeg. The real
constraint is process lifetime: rendering is minutes of CPU and gigabytes of temp files,
so it needs a long-running worker regardless of language. It cannot run in a serverless
function.

### Behaviours that must survive the port

Each exists because of a real bug, and each is easy to lose in a rewrite:

- A **+0.1s** duration margin — frame rounding otherwise leaves a black tail.
- BT.709 conversion **and** tagging, or colours shift in players and on YouTube.
- Codec probing with runtime fallback to `libx264` when a hardware encoder fails.
- Audio duration measured from the **written file**, not the last word boundary. Edge TTS
  leaves ~0.88s of tail, which is 19% of a short clip.
- Subtitle font paths confined to the fonts directory (path-traversal guard).

## Known rough edges

- Rendering still requires the Python engine.
- Progress polls every 2 seconds; the engine's richer per-clip logs are not streamed yet.
- No task history — closing the tab loses the UI's view of a render, though the file
  still lands on disk.
- Settings have an API but no UI.
- Engine task state is in-memory, so it does not survive a restart.

## Licence

MIT. Derived from [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)
(MIT, © 2024 Harry), whose copyright notice is preserved in [LICENSE](./LICENSE).

Generated videos use third-party stock footage and synthesised speech. Check the terms of
Pixabay, Pexels, and Microsoft Edge TTS before publishing at volume or monetising.
