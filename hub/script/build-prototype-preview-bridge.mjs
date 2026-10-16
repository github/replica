import { build } from "vite"

import { viteAliases } from "../vite-aliases.ts"

const assets = new URL("../../.github/extensions/replica-prototype/assets/", import.meta.url)
await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  resolve: { alias: viteAliases },
  build: {
    emptyOutDir: false,
    minify: true,
    // This module is injected directly, not published for further bundling.
    rolldownOptions: { output: { minify: true } },
    outDir: assets.pathname,
    lib: {
      entry: new URL(
        "../app/javascript/application/prototype-preview-bridge/index.ts",
        import.meta.url,
      ).pathname,
      formats: ["es"],
      name: "ReplicaCanvasBridge",
      fileName: () => "canvas-bridge.js",
    },
  },
})

await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  resolve: {
    alias: {
      "@utils": new URL("../app/javascript/utils/", import.meta.url).pathname,
    },
  },
  build: {
    emptyOutDir: false,
    outDir: assets.pathname,
    lib: {
      entry: new URL("../app/javascript/utils/review-anchor/validate-anchor.ts", import.meta.url)
        .pathname,
      formats: ["es"],
      fileName: () => "review-anchor-validation.mjs",
    },
  },
})

// The extension validates served definitions with Hub's validator without an npm install.
await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    emptyOutDir: false,
    minify: true,
    rolldownOptions: { output: { minify: true } },
    outDir: assets.pathname,
    lib: {
      entry: new URL(
        "../app/javascript/utils/prototype-controls/controls-validation.mjs",
        import.meta.url,
      ).pathname,
      formats: ["es"],
      fileName: () => "controls-validator.mjs",
    },
  },
})
