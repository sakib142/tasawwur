import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Native modules the bundler must not touch.
   *
   * Each ships a compiled .node addon, which cannot be placed in an ESM chunk.
   * Listing them here leaves them to be required at runtime instead. Without
   * this every route that imports anything from @tasawwur/core fails, because
   * the package index re-exports the renderer.
   */
  serverExternalPackages: [
    "@napi-rs/canvas",
    "kokoro-js",
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
