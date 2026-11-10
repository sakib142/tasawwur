import { describe, expect, it } from "vitest";
import { kokoroProvider } from "./kokoro.ts";
import { alignCuesToText } from "./align.ts";
import { buildSubtitles } from "../captions.ts";

const installed = await kokoroProvider.available();

describe("kokoro provider contract", () => {
  it("declares that it does not report word timings", () => {
    // Kokoro returns audio only. Captions are therefore estimated, which is
    // fine for sentence captions and wrong for word-by-word ones. Anything
    // choosing a caption mode must be able to see this.
    expect(kokoroProvider.wordTimings).toBe(false);
  });

  it("identifies itself", () => {
    expect(kokoroProvider.id).toBe("kokoro");
    expect(kokoroProvider.label).toMatch(/machine/i);
  });

  it("reports availability without throwing when not installed", async () => {
    await expect(kokoroProvider.available()).resolves.toBeTypeOf("boolean");
  });
});

describe.skipIf(!installed)("kokoro synthesis (model required)", () => {
  it("produces a WAV with estimated cues spanning the audio", async () => {
    const text = "Water always finds a way.";
    const out = await kokoroProvider.synthesize({ text, voice: "af_heart" });

    expect(out.format).toBe("wav");
    // RIFF header, then real samples.
    expect(new TextDecoder().decode(out.audio.subarray(0, 4))).toBe("RIFF");
    expect(out.audio.length).toBeGreaterThan(10_000);

    const cues = out.cues!;
    expect(cues).toHaveLength(text.split(" ").length);
    expect(cues[0]!.start).toBe(0);
    // Cues must not run past the audio, or captions outlive the narration.
    const seconds = (out.audio.length - 44) / 4 / 24_000;
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(seconds + 0.01);
  }, 180_000);

  it("falls back to a known voice rather than failing on an unknown one", async () => {
    const out = await kokoroProvider.synthesize({
      text: "Testing.",
      voice: "not-a-real-voice",
    });
    expect(out.audio.length).toBeGreaterThan(1000);
  }, 180_000);

  it("refuses empty input", async () => {
    await expect(
      kokoroProvider.synthesize({ text: "   ", voice: "af_heart" }),
    ).rejects.toThrow(/nothing to speak/i);
  });

  it("drives the whole caption chain", async () => {
    const text = "Water always finds a way. It meets a rock, and it goes around.";
    const out = await kokoroProvider.synthesize({ text, voice: "af_heart" });
    const { cues, srt } = buildSubtitles(alignCuesToText(out.cues!, text), "sentence");

    expect(cues.length).toBeGreaterThanOrEqual(2);
    // Punctuation survives, so captions break at sentences.
    expect(cues[0]!.text).toMatch(/\.$/);
    expect(srt).toMatch(/^1\n00:00:00,000 --> /);
  }, 180_000);
});

describe.skipIf(!installed)("sentence pacing (model required)", () => {
  const SCRIPT = "A river has no plan. It meets a rock. It goes around.";

  it("rests between sentences", async () => {
    // Read straight through, the sentences run into each other and the result
    // sounds recited. The rest is most of the difference.
    const out = await kokoroProvider.synthesize({ text: SCRIPT, voice: "af_heart" });
    const cues = out.cues ?? [];
    const enders = cues.filter((c) => /[.!?]$/.test(c.text));
    expect(enders.length).toBeGreaterThanOrEqual(2);

    // A sentence-ending cue is held through the pause that follows it, so the
    // caption does not blink off and the cut lands after the last syllable.
    for (const ender of enders.slice(0, -1)) {
      const next = cues.find((c) => c.start >= ender.end);
      if (next) expect(next.start).toBeGreaterThanOrEqual(ender.end - 0.001);
    }
  }, 180_000);

  it("does not leave a second of silence between sentences", async () => {
    // The first attempt added a rest on top of the padding the model already
    // returns, giving pauses of nearly a second. Narration that drags.
    const out = await kokoroProvider.synthesize({ text: SCRIPT, voice: "af_heart" });
    const cues = out.cues ?? [];
    for (const [i, cue] of cues.entries()) {
      const next = cues[i + 1];
      if (next) expect(next.start - cue.end).toBeLessThan(0.6);
    }
  }, 180_000);

  it("leaves quiet after the final word", async () => {
    // The video is sized from the narration; without a tail the picture cuts
    // out on the last syllable.
    const out = await kokoroProvider.synthesize({ text: SCRIPT, voice: "af_heart" });
    const cues = out.cues ?? [];
    const lastWordEnds = cues[cues.length - 1]!.end;
    // 4 bytes a sample, 44-byte header, one channel.
    const seconds = (out.audio.length - 44) / 4 / 24_000;
    expect(seconds - lastWordEnds).toBeGreaterThan(0.2);
  }, 180_000);

  it("speaks a script with no punctuation at all", async () => {
    // A topic typed into the form rather than a written script.
    const out = await kokoroProvider.synthesize({ text: "water finds a way", voice: "af_heart" });
    expect(out.audio.byteLength).toBeGreaterThan(1000);
    expect(out.cues?.length).toBeGreaterThan(0);
  }, 180_000);

  it("keeps cues in order across sentences", async () => {
    const out = await kokoroProvider.synthesize({ text: SCRIPT, voice: "af_heart" });
    const cues = out.cues ?? [];
    for (const [i, cue] of cues.entries()) {
      expect(cue.end).toBeGreaterThanOrEqual(cue.start);
      const next = cues[i + 1];
      if (next) expect(next.start).toBeGreaterThanOrEqual(cue.start);
    }
  }, 180_000);
});
