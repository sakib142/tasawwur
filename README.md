# tasawwur · تصور

**To imagine, and to picture — the same word in Arabic.** Describe something; get the
picture back.

tasawwur turns a script into a narrated short video. It speaks the words on your own
machine, finds stock footage that matches each line, cuts the picture where the
sentences end, grades the clips so they sit together, lays captions over the top and
mixes music underneath. The result is an MP4.

**It costs nothing to run.** Speech is a local model, rendering is ffmpeg, footage comes
from a free Pixabay key and the music is public domain. There is no metered API anywhere
in it.

[![licence: MIT](https://img.shields.io/badge/licence-MIT-black)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-20%2B-black)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-black)

---

## What it can and cannot make

Worth knowing before writing anything, because it is the difference between a video you
would publish and twenty seconds of the wrong thing.

**Good at** subjects rather than specific things — landscape, weather, nature, cities in
general, mood and reflection. Motivational and quote videos, meditation and sleep
pieces, faceless shorts, voiceover essays.

**Cannot do** a named city, a named product, a brand, or a person doing something
specific. Stock libraries do not hold them. A search for `Riyadh skyline` returns
Sydney. `cold brew` returns four clips of snow, because the provider matches on the word
"cold". No amount of code fixes a library that does not contain the shot.

So the tool says so, rather than quietly cutting the wrong footage in:

```
≈ cold brew       the search ignored "brew" — these clips match "cold" only
✕ athlete         no usable footage at this aspect ratio
! hiking          12 of 14 clips are by one contributor, so it will look repetitive
✓ mountain trail  6 clips from 4 creators. Plenty of variety.
```

Check the terms first. It takes seconds and saves a render.

## Quick start

**Requirements:** Node 20+, pnpm 10+, and [ffmpeg](https://ffmpeg.org/) on your PATH.

```bash
git clone https://github.com/sakib142/tasawwur.git
cd tasawwur
pnpm install
pnpm music          # optional: fetch the public-domain music beds
pnpm dev            # http://localhost:3100
```

Then open **Settings** and paste a [Pixabay API key](https://pixabay.com/api/docs/) —
free, instant, no card. That one key powers footage search and the term checker.

### Speech on your own machine

Narration runs locally through [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), an
Apache-2.0 model. Nothing is sent anywhere and nothing is billed. It is not installed by
default, because the ONNX runtime it needs is around 400MB:

```bash
npx pnpm@12 install   # fetches the optional kokoro-js
```

Twenty-eight voices, each shown with the grade its authors gave it — quality varies a
great deal between them, and an A voice and a D voice are not close.

### Having the script written for you

Optional. Given only a topic, tasawwur can write the script and the search terms through
a CLI you are already signed in to — the Claude CLI, or a local Ollama model. It uses an
existing subscription rather than a metered key, which is the point. Write the script
yourself and none of this runs.

## How it works

```
script ──> sentences
             │
             ├─> speech     one sentence at a time, locally, with a rest between each;
             │              sentence boundaries are measured rather than guessed
             │
             ├─> footage    search each term · drop anything that does not answer the
             │              whole term · match each clip to the line it sits under ·
             │              prefer contributors not already used
             │
             └─> render     cut on sentence ends · one grade across every clip ·
                            captions drawn to PNG · music ducked under the voice
```

TypeScript end to end. No Python, no external service, no render farm — ffmpeg does the
work on your machine.

### The ideas worth knowing

- **Cuts land where sentences end.** The picture never changes mid-word. Shot lengths
  come from the narration timeline rather than a fixed interval, so they vary the way
  sentences do.
- **Footage is matched to the line it sits under.** Clip tags are compared against the
  sentence, so "it meets a cliff, and it falls" pulls a waterfall rather than whatever
  the keyword returned first.
- **One grade across every clip.** Stock arrives from different creators with different
  white balance; matching it is most of what makes a montage look deliberate.
- **Music ducks under speech.** Sidechain compression rather than a flat mix, so the bed
  is audible between sentences and out of the way during them.
- **Nothing is hidden.** Preview the clips before rendering — reorder them, swap them,
  and see which lines the footage does not actually answer.

## Features

| | |
|---|---|
| **Aspect** | 9:16, 1:1, 16:9 |
| **Speech** | Kokoro, local, 28 voices, no key |
| **Footage** | Pixabay (free key), Pexels, or your own uploads |
| **Stills** | Photographs held and slowly pushed, Ken Burns style |
| **Captions** | Sentence or word-by-word · any bundled font · styled and positioned |
| **Music** | Public-domain beds, mixed and ducked under the narration |
| **Pace** | Snappy, even or measured — all cutting on sentence ends |
| **Script** | Write it yourself, or have a CLI you already pay for write it |

## Configuration

Everything has a working default. These only override where things live:

| Variable | Purpose |
|---|---|
| `TASAWWUR_STORAGE` | Where rendered videos and uploads go. |
| `TASAWWUR_SETTINGS` | The settings file, which holds API keys. |
| `TASAWWUR_FONTS` | Caption fonts, if kept elsewhere. |
| `TASAWWUR_MUSIC` | Music beds, if kept elsewhere. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | ffmpeg, if it is not on your PATH. |

API keys live in the settings file, outside the repository. They are never written into
a task record and never put in a URL. See `apps/web/.env.example`.

## Development

```bash
pnpm dev         # the app, at :3100
pnpm test        # unit and integration tests
pnpm typecheck   # every package
pnpm build       # production build
pnpm music       # fetch the public-domain music beds (not committed)
```

```
apps/web          the interface and its API routes
packages/core     speech, search, selection, rendering, the pipeline
packages/schema   the typed contract shared by both
scripts/          verification tools — see below
```

Music is fetched rather than committed: five beds is twenty-odd megabytes and git keeps
binaries forever. `scripts/fetch-music.mts` records the source and licence of each.
Without it the app still runs — videos are narration over silence, and the picker says
so.

### Verifying a change

Rendering fails quietly. A video can have the right duration, the right resolution and
no warnings at all, and still be wrong — so checks measure the file that came out rather
than the intent that went in.

```bash
pnpm tsx scripts/check-cuts.mts --pace snappy clip1.mp4 clip2.mp4
```

That renders a real video and reports whether every cut landed on a sentence end, by
detecting the cuts in the finished file. The defect it exists for was real: the voice
broke at 1.6 / 4.4 / 6.7s while the picture cut at a flat 5.0s.

Music is checked by measuring loudness inside and outside speech, not by trusting that
the filter ran. Framing is checked by sampling frames. `docs/DECISIONS.md` records what
was tried and rejected, and why.

## Known limits

Stated plainly, because finding them in a finished video is worse.

- **Specific places, products and brands are out of reach.** See the top of this file.
- **Word-by-word captions drift.** Kokoro reports no word timings, so they are estimated
  from word length. Sentence boundaries are exact; words within a sentence are not. The
  interface says so where you choose it.
- **Pixabay's vertical library is thinner than its landscape one.** Some terms return
  nothing usable at 9:16 that would be fine at 16:9.
- **Rendering is CPU-bound** and runs on your machine — roughly three to five minutes
  for forty seconds of video.
- **Form state is not kept across a refresh.** The render is; the script you typed is not.

## Contributing

Issues and pull requests are welcome. Two things make a change easy to accept:

1. **Measure the output, not the intent.** If it changes how the video looks or sounds,
   show the measurement — a frame, a loudness figure, a cut timing.
2. **Say why in the code.** Comments here carry the reasoning and the failure behind a
   decision rather than restating the line. Follow the surrounding style.

`pnpm test` and `pnpm typecheck` should both be clean before opening a PR.

## Licence

[MIT](LICENSE).

Bundled fonts are under the SIL Open Font License 1.1. Music fetched by `pnpm music` is
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) — public domain, so a video
made with it owes nobody anything. Footage from Pixabay and Pexels is covered by their
own licences, both of which allow commercial use without attribution.

---

<sub>**Keywords** — AI video generator · text to video · script to video · faceless video
generator · YouTube Shorts automation · TikTok video generator · Instagram Reels maker ·
open source video automation · self-hosted video generator · free video generator ·
local text to speech · Kokoro TTS · automatic subtitle generator · caption burner ·
ffmpeg video pipeline · stock footage automation · Pixabay API · Pexels API · Next.js ·
TypeScript · faceless YouTube channel · short form video tool</sub>
