import { describe, expect, it } from "vitest";
import { RenderError, capabilities, probe, resetCapabilities } from "./ffmpeg.ts";

const available = await capabilities().then(() => true).catch(() => false);

describe("capability probing", () => {
  it("reports an encoder only after it has actually encoded", async () => {
    // An encoder can be listed and still fail at runtime — hardware ones in
    // particular, when no device is present. Listing is not evidence.
    if (!available) return;
    const caps = await capabilities();
    expect(caps.workingEncoders.length).toBeGreaterThan(0);
    expect(caps.workingEncoders).toContain("libx264");
  }, 60_000);

  it("knows which filters this build has", async () => {
    if (!available) return;
    const caps = await capabilities();
    expect(caps.filters.has("overlay")).toBe(true);
    expect(caps.filters.has("scale")).toBe(true);
  }, 60_000);

  it("explains how to fix a missing ffmpeg rather than failing opaquely", async () => {
    resetCapabilities();
    await expect(capabilities("/no/such/ffmpeg", "/no/such/ffprobe")).rejects.toThrow(
      /FFMPEG_PATH/,
    );
    resetCapabilities();
  }, 30_000);

  it("does not cache a failed probe", async () => {
    // Otherwise installing ffmpeg would not take effect until a restart.
    resetCapabilities();
    await expect(capabilities("/no/such/ffmpeg")).rejects.toThrow();
    resetCapabilities();
    if (available) await expect(capabilities()).resolves.toBeDefined();
  }, 60_000);
});

describe("probe", () => {
  it("names the file it could not read", async () => {
    await expect(probe("/no/such/clip.mp4")).rejects.toThrow(/no\/such\/clip\.mp4/);
  }, 30_000);
});

describe("RenderError", () => {
  it("carries the command and the tail of ffmpeg's output", () => {
    const e = new RenderError("boom", { command: "ffmpeg -i x", stderrTail: "oops" });
    expect(e.name).toBe("RenderError");
    expect(e.command).toBe("ffmpeg -i x");
    expect(e.stderrTail).toBe("oops");
  });
});
