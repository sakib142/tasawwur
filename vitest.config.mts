import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Integration tests hit a real engine and a real TTS endpoint.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
