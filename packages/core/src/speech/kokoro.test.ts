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
