import { describe, expect, it } from "vitest";
import { buildScriptPrompt, buildTermsPrompt, extractStringArray } from "./prompts.ts";

describe("buildScriptPrompt", () => {
  it("converts seconds into a word target at narration pace", () => {
    // ~2.6 words per second.
    expect(buildScriptPrompt({ subject: "x", targetSeconds: 40 })).toContain("104 words");
    expect(buildScriptPrompt({ subject: "x", targetSeconds: 20 })).toContain("52 words");
  });

  it("includes language and guidance only when given", () => {
    const bare = buildScriptPrompt({ subject: "rivers" });
    expect(bare).not.toMatch(/Write it in/);
    expect(bare).not.toMatch(/Additional direction/);

    const full = buildScriptPrompt({
      subject: "rivers",
      language: "Arabic",
      guidance: "for children",
    });
    expect(full).toContain("Write it in Arabic.");
    expect(full).toContain("Additional direction: for children");
  });
});

describe("buildTermsPrompt", () => {
  it("asks for narrative order only when requested", () => {
    expect(buildTermsPrompt({ script: "s", inScriptOrder: true })).toMatch(/in the order/);
    expect(buildTermsPrompt({ script: "s" })).toMatch(/any order/);
  });
});

describe("extractStringArray", () => {
  it("parses a plain JSON array", () => {
    expect(extractStringArray('["a","b"]')).toEqual(["a", "b"]);
  });

  it("parses an array inside a code fence", () => {
    expect(extractStringArray('```json\n["a","b"]\n```')).toEqual(["a", "b"]);
  });

  it("finds an array buried in prose", () => {
    // Models add a preamble often enough that strict parsing rejects output
    // that is otherwise perfectly usable.
    expect(extractStringArray('Here you go:\n["waterfall","river"]\nHope that helps.')).toEqual([
      "waterfall",
      "river",
    ]);
  });

  it("drops non-strings and blanks rather than passing them downstream", () => {
    expect(extractStringArray('["a", 2, "", "  ", "b"]')).toEqual(["a", "b"]);
  });

  it("trims whitespace around terms", () => {
    expect(extractStringArray('["  cat paw  "]')).toEqual(["cat paw"]);
  });

  it("returns null when there is nothing usable", () => {
    expect(extractStringArray("no array here")).toBeNull();
    expect(extractStringArray("[]")).toBeNull();
    expect(extractStringArray('{"terms":["a"]}')).toBeNull();
  });
});
