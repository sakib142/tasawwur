import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, Settings, listFonts, listVoices, redact, readSettings, writeSettings } from "./index.ts";

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
    await writeSettings({ defaultVoice: "en-GB-SoniaNeural-Female" });
    const after = await writeSettings({ videoSource: "pexels" });
    expect(after.defaultVoice).toBe("en-GB-SoniaNeural-Female");
    expect(after.videoSource).toBe("pexels");
  });

  it("falls back to defaults on a corrupt file rather than throwing", async () => {
    await writeFile(process.env.TASAWWUR_SETTINGS!, "{ not json");
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects invalid values", () => {
    expect(Settings.safeParse({ engineUrl: "not-a-url" }).success).toBe(false);
    expect(Settings.safeParse({ videoSource: "youtube" }).success).toBe(false);
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

// Hits Microsoft's public catalogue; skipped when offline.
const online = await fetch("https://speech.platform.bing.com", {
  signal: AbortSignal.timeout(4000),
}).then(() => true).catch(() => false);

describe.skipIf(!online)("voices (live catalogue)", () => {
  it("returns ids in the exact form the engine expects", async () => {
    const voices = await listVoices({ locales: ["en"] });
    expect(voices.length).toBeGreaterThan(20);
    // "<ShortName>-<Gender>" — the engine dispatches on this string alone.
    for (const v of voices) expect(v.id).toBe(`${v.shortName}-${v.gender}`);
    expect(voices.some((v) => v.id === "en-US-AvaNeural-Female")).toBe(true);
  }, 30_000);

  it("filters by locale prefix", async () => {
    const ar = await listVoices({ locales: ["ar"] });
    expect(ar.length).toBeGreaterThan(0);
    expect(ar.every((v) => v.locale.startsWith("ar"))).toBe(true);
  }, 30_000);
});
