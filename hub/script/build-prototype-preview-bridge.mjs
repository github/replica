import { copyFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { build } from "vite"

import { viteAliases } from "../vite-aliases.ts"

const assets = new URL("../../.github/extensions/replica-prototype/assets/", import.meta.url)
await copyFile(
  new URL("../public/avatar-placeholder.svg", import.meta.url),
  new URL("avatar-placeholder.svg", assets),
)
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
    outDir: fileURLToPath(assets),
    lib: {
      entry: fileURLToPath(
        new URL("../client/application/prototype-preview-bridge/index.ts", import.meta.url),
      ),
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
      "@utils": fileURLToPath(new URL("../client/utils/", import.meta.url)),
    },
  },
  build: {
    emptyOutDir: false,
    minify: true,
    rolldownOptions: { output: { minify: true } },
    outDir: fileURLToPath(assets),
    lib: {
      entry: fileURLToPath(
        new URL("../client/utils/review-anchor/validate-anchor.ts", import.meta.url),
      ),
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
    outDir: fileURLToPath(assets),
    lib: {
      entry: fileURLToPath(
        new URL("../client/utils/prototype-controls/controls-validation.mjs", import.meta.url),
      ),
      formats: ["es"],
      fileName: () => "controls-validator.mjs",
    },
  },
})
