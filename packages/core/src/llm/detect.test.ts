import { describe, expect, it } from "vitest";
import { detectClaudeCli, isBillingRedirect, safeEnv } from "./detect.ts";

describe("billing redirects", () => {
  it.each([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "AWS_BEARER_TOKEN_BEDROCK",
  ])("treats %s as a billing redirect", (name) => {
    // Each of these turns a subscription call into a billed one.
    expect(isBillingRedirect(name)).toBe(true);
  });

  it.each([
    ["CLAUDE_CODE_OAUTH_TOKEN", "the subscription credential itself"],
    ["ANTHROPIC_CONFIG_DIR", "only says where credentials live"],
    ["CLAUDE_CONFIG_DIR", "only says where credentials live"],
    ["PATH", "unrelated"],
  ])("keeps %s — %s", (name) => {
    expect(isBillingRedirect(name)).toBe(false);
  });

  it("strips redirects while keeping the subscription usable", () => {
    const { env, removed } = safeEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "sk-live",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "subscription",
      ANTHROPIC_CONFIG_DIR: "/creds",
    });
    expect(removed).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK"]);
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("subscription");
    expect(env.ANTHROPIC_CONFIG_DIR).toBe("/creds");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("does not mutate the environment it was given", () => {
    const original = { ANTHROPIC_API_KEY: "sk" };
    safeEnv(original);
    expect(original.ANTHROPIC_API_KEY).toBe("sk");
  });
});

describe("detectClaudeCli", () => {
  it("explains which path failed rather than only that it failed", async () => {
    const status = await detectClaudeCli("/definitely/not/here/claude");
    expect(status.found).toBe(false);
    expect(status.usable).toBe(false);
    expect(status.message).toContain("/definitely/not/here/claude");
  });

  it("reports a usable CLI as costing nothing per use", async () => {
    const status = await detectClaudeCli();
    if (!status.found) return; // no CLI on this machine; nothing to assert
    expect(status.version).toMatch(/^\d+\.\d+/);
    if (status.usable) expect(status.message).toMatch(/nothing metered/i);
  }, 30_000);
});
