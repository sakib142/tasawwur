import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, GOOD_GRADES, KOKORO_VOICES, Settings, listFonts, redact, readSettings, writeSettings } from "./index.ts";

describe("settings", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasawwur-test-"));
    process.env.TASAWWUR_SETTINGS = join(dir, "settings.json");
  });
  afterAll(async () => {
    delete process.env.TASAWWUR_SETTINGS;
    await rm(dir, { recursive: true, force: true });
  });

  it("returns defaults when nothing is stored", async () => {
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a partial update without clobbering other fields", async () => {
    await writeSettings({ defaultVoice: "bf_emma" });
    const after = await writeSettings({ videoSource: "pexels" });
    expect(after.defaultVoice).toBe("bf_emma");
    expect(after.videoSource).toBe("pexels");
  });

  it("falls back to defaults on a corrupt file rather than throwing", async () => {
    await writeFile(process.env.TASAWWUR_SETTINGS!, "{ not json");
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("drops a stored voice the speech model cannot use", async () => {
    // Settings written before the switch hold ids from a provider we no longer
    // synthesise with. They parse fine and then fail silently at render time.
    await writeFile(
      process.env.TASAWWUR_SETTINGS!,
      JSON.stringify({ defaultVoice: "en-GB-SoniaNeural-Female" }),
    );
    expect((await readSettings()).defaultVoice).toBe("af_heart");
  });

  it("keeps a stored voice it recognises", async () => {
    await writeSettings({ defaultVoice: "am_michael" });
    expect((await readSettings()).defaultVoice).toBe("am_michael");
  });

  it("rejects invalid values", () => {
    expect(Settings.safeParse({ engineUrl: "not-a-url" }).success).toBe(false);
    expect(Settings.safeParse({ videoSource: "youtube" }).success).toBe(false);
  });

  it("keeps a stored key when the update omits it", async () => {
    // The settings form cannot show a stored key, so it sends the field only
    // when the user typed a new one. An omitted key must mean "leave it",
    // never "clear it".
    await writeSettings({ pixabayApiKey: "stored-key" });
    await writeSettings({ videoSource: "local" });
    const after = await readSettings();
    expect(after.pixabayApiKey).toBe("stored-key");
    expect(after.videoSource).toBe("local");
  });

  it("never exposes API keys, only whether they are set", () => {
    const r = redact(Settings.parse({ pixabayApiKey: "secret", pexelsApiKey: "" }));
    expect(r).not.toHaveProperty("pixabayApiKey");
    expect(r).not.toHaveProperty("pexelsApiKey");
    expect(r.pixabayApiKeySet).toBe(true);
    expect(r.pexelsApiKeySet).toBe(false);
  });
});

describe("fonts", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "tasawwur-fonts-"));
    for (const f of ["BeVietnamPro-Bold.ttf", "STHeitiMedium.ttc", "notes.txt"]) {
      await writeFile(join(dir, f), "");
    }
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("lists only font files and ranks recommended faces first", async () => {
    const fonts = await listFonts(dir);
    expect(fonts.map((f) => f.id)).toEqual(["BeVietnamPro-Bold.ttf", "STHeitiMedium.ttc"]);
    expect(fonts[0]!.recommended).toBe(true);
    expect(fonts[0]!.label).toBe("BeVietnamPro Bold");
  });

  it("explains what to fix when the directory is unreadable", async () => {
    await expect(listFonts("/no/such/dir")).rejects.toThrow(/Cannot read fonts/);
  });
});


describe("voice catalogue", () => {
  it("lists the voices the renderer can actually use", () => {
    // This previously served a different provider's catalogue, so the picker
    // offered names the renderer could not use and quietly substituted its
    // default. Every id here must be one the model accepts.
    expect(KOKORO_VOICES.length).toBeGreaterThan(20);
    for (const v of KOKORO_VOICES) {
      expect(v.id).toMatch(/^[a-z]{2}_[a-z]+$/);
      expect(v.name).toBeTruthy();
      expect(["Male", "Female"]).toContain(v.gender);
    }
  });

  it("is ordered best first", () => {
    expect(KOKORO_VOICES[0]!.grade).toBe("A");
    expect(GOOD_GRADES.has(KOKORO_VOICES[0]!.grade)).toBe(true);
    // The tail is genuinely worse, which is why grade is surfaced at all.
    expect(GOOD_GRADES.has(KOKORO_VOICES.at(-1)!.grade)).toBe(false);
  });

  it("has no duplicate ids", () => {
    expect(new Set(KOKORO_VOICES.map((v) => v.id)).size).toBe(KOKORO_VOICES.length);
  });
});

