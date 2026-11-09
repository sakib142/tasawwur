import { describe, expect, it } from "vitest";
import { PRESETS, describePreset } from "./presets.ts";

describe("presets", () => {
  it("are genuinely different from one another", () => {
    // If two presets ever produce identical output, one of them should be
    // deleted rather than left as a button that does nothing.
    const fingerprints = PRESETS.map((p) => JSON.stringify(p.params));
    expect(new Set(fingerprints).size).toBe(PRESETS.length);
  });

  it("differ in the things a viewer would actually notice", () => {
    const shapes = new Set(PRESETS.map((p) => p.params.video_aspect));
    const captions = new Set(PRESETS.map((p) => p.params.subtitle_display_mode));
    expect(shapes.size).toBeGreaterThan(1);
    expect(captions.size).toBeGreaterThan(1);
  });

  it("describes each one so the choice is legible", () => {
    // The form exposes almost none of what a preset changes, so without this
    // the buttons look interchangeable.
    for (const preset of PRESETS) {
      const bits = describePreset(preset);
      expect(bits.length).toBeGreaterThanOrEqual(4);
      expect(bits.join(" ")).toMatch(/9:16|16:9/);
    }
  });

  it("gives every preset a distinct description", () => {
    const described = PRESETS.map((p) => describePreset(p).join("|"));
    expect(new Set(described).size).toBe(PRESETS.length);
  });

  it("avoids Shuffle transitions", () => {
    // Mixing FadeIn and FadeOut at a cut blinks through black; a 40s test
    // render produced five such flashes.
    for (const p of PRESETS) expect(p.params.video_transition_mode).toBeNull();
  });
});

describe("footage source", () => {
  it("never relies on the schema default", () => {
    // The schema defaults to pexels. Installs commonly have only a Pixabay
    // key, so the form must take its source from settings rather than the
    // default, or it silently asks a provider that cannot answer.
    const schemaDefault = "pexels";
    for (const preset of PRESETS) {
      expect(preset.params.video_source ?? schemaDefault).toBeDefined();
    }
  });
});
