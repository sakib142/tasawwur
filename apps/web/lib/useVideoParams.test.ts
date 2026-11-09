import { describe, expect, it } from "vitest";
import { VideoParams } from "@tasawwur/schema";
import { PRESETS } from "./presets.ts";

/**
 * Presets seed the form rather than locking it. These cover the contract that
 * makes that safe — every preset must produce a valid, complete parameter set,
 * because the sections render directly from it.
 */
describe("presets as seed values", () => {
  it.each(PRESETS.map((p) => [p.label, p] as const))(
    "%s parses into a complete parameter set",
    (_label, preset) => {
      const parsed = VideoParams.parse(preset.params);
      expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(37);
      expect(parsed.video_aspect).toBeTruthy();
      expect(parsed.font_size).toBeGreaterThan(0);
    },
  );

  it("leaves every field editable after seeding", () => {
    // The failure this guards against: a preset value that cannot be
    // overridden because the schema rejects the edited value.
    const seeded = VideoParams.parse(PRESETS[1]!.params);
    const edited = VideoParams.parse({ ...seeded, font_size: 42, video_aspect: "1:1" });
    expect(edited.font_size).toBe(42);
    expect(edited.video_aspect).toBe("1:1");
  });

  it("accepts every value the Video section can produce", () => {
    for (const aspect of ["9:16", "16:9", "1:1"] as const) {
      for (const fit of ["cover", "contain"] as const) {
        expect(VideoParams.safeParse({ video_aspect: aspect, video_fit_mode: fit }).success).toBe(true);
      }
    }
    for (const t of [null, "FadeIn", "SlideOut", "ZoomIn", "Shuffle"]) {
      expect(VideoParams.safeParse({ video_transition_mode: t }).success).toBe(true);
    }
  });

  it("accepts every value the Subtitle section can produce", () => {
    for (const pos of ["top", "center", "bottom", "two_thirds_bottom", "custom"]) {
      expect(VideoParams.safeParse({ subtitle_position: pos }).success).toBe(true);
    }
    // The background toggle flips between false and a colour string.
    expect(VideoParams.safeParse({ text_background_color: false }).success).toBe(true);
    expect(VideoParams.safeParse({ text_background_color: "#000000" }).success).toBe(true);
  });

  it("rejects slider values outside the ranges the UI allows", () => {
    expect(VideoParams.safeParse({ custom_position: 101 }).success).toBe(false);
    expect(VideoParams.safeParse({ video_clip_duration: 0 }).success).toBe(false);
    expect(VideoParams.safeParse({ voice_rate: 0 }).success).toBe(false);
    expect(VideoParams.safeParse({ stroke_width: -1 }).success).toBe(false);
  });

  it("sends video_subject even when only a script is given", () => {
    // The renderer requires the field to be present. Omitting it returns
    // "body.video_subject: Field required" rather than rendering.
    const parsed = VideoParams.parse({ video_script: "A river has no plan." });
    expect(parsed).toHaveProperty("video_subject");
    expect(parsed.video_subject).toBe("");
  });
});
