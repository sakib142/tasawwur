# Decisions

Durable choices and the reasoning behind them. Short entries, newest last.

---

## Services are written from protocols and specifications, not from other code

**Decision.** Every service here is implemented against a public protocol, a
published API, or observed behaviour — never by reading and translating another
project's implementation.

**Why.** tasawwur contains no third-party source, and that position is worth
keeping. Interfaces are weakly protected and freely reimplementable: a field
name, a wire format, an HTTP contract. Implementations are not. Translating
someone's source file into another language is still derivation, whatever
language comes out the other end.

**In practice.**

| Service | Built from |
|---|---|
| Voice catalogue | Microsoft's public Edge TTS endpoint |
| Speech | the Edge TTS WebSocket protocol |
| Stock search | Pixabay's published REST API |
| Renderer | ffmpeg's documentation, plus output characteristics measured from finished video |

**Specifically for the renderer.** Build it from *behaviour*, not from another
project's render code. The properties worth matching were measured directly from
output files and can be re-measured at any time:

- A small duration margin beyond the narration — frame rounding otherwise leaves
  a black tail at the end.
- BT.709 conversion **and** tagging. Untagged HD is decoded as BT.709 by players
  regardless, so an untagged BT.601 conversion shifts the colours.
- Encoder probing with fallback. Hardware encoders can be present but fail at
  runtime; libx264 is the floor.
- Audio duration taken from the written file rather than the last word boundary.
  Edge TTS leaves roughly 0.88s of tail, which is 19% of a short clip.

Each of those is a measurable fact about a video file. Verify with `ffprobe` and
`blackdetect`; do not consult another implementation.

**Cost.** Slower than translating. Some edge cases will be rediscovered the hard
way. Accepted deliberately.


---

## Speech synthesis is pluggable, and Edge TTS is not the provider

**Decision.** Synthesis sits behind a `SpeechProvider` interface. Edge TTS is
not implemented as a local provider.

**Why.** Microsoft guards synthesis with a rotating token (`Sec-MS-GEC`) whose
current scheme is undocumented and exists specifically to exclude independent
clients. Implementing it is not a one-off cost — it is a standing commitment to
re-derive the scheme whenever it rotates, for the single feature everything else
depends on. The protocol implementation in `speech/edge.ts` is otherwise
complete and is kept for reference, unexported.

Note the voice *catalogue* is unaffected: that endpoint is plain HTTPS and is
used directly.

**What the interface declares.** Providers differ in one way that matters:
whether they report when each word is spoken. Word-accurate captions are free
with that timeline and estimated without it, so `wordTimings` is declared rather
than assumed. Estimation weights words by the square root of their length, which
is fine for sentence captions and visibly wrong for word-by-word ones.

**Consequence worth knowing.** Timelines carry *spoken* words, so they arrive
without punctuation — "Why is the sky blue Sunlight looks white". Captions built
from that break mid-phrase on length alone. `alignCuesToText` matches the
timeline back onto the script so the written form wins. Measured on a finished
108-word render, this turned four length-truncated captions into twelve that
break at sentences, with no text lost.


---

## Local speech is optional, and pnpm must be 12 or newer to install it

**Decision.** `kokoro-js` is an `optionalDependency`. The project runs without it.

**Why.** It pulls the ONNX runtime, roughly 400MB on disk — too much to force on
someone cloning the repo to read the code or use the hosted path. The provider
imports it dynamically and reports `available() === false` when absent, so
nothing breaks; local speech simply is not offered.

**pnpm 10.15 cannot install it.** It runs out of heap extracting the runtime
tarball:

    FATAL ERROR: invalid array length Allocation failed - JavaScript heap out of memory
      at Builtins_TypedArrayPrototypeJoin

`NODE_OPTIONS=--max-old-space-size` does not help — the crash is inside a worker
thread. npm cannot be used as a substitute inside a pnpm workspace: it rejects
the `workspace:` protocol, and fails at the root on pnpm's symlink layout.
pnpm 12.18 installs it in 15 seconds. The `packageManager` field is set
accordingly.

**What Kokoro does not provide: word timings.** It returns audio and a sample
rate, nothing more. Captions are therefore estimated from word length, which is
fine for sentence captions and visibly wrong for word-by-word ones. This is why
`SpeechProvider` declares `wordTimings` rather than assuming it — anything
offering a caption mode can see which it is dealing with and say so.
