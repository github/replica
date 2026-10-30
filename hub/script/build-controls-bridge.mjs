import { build } from "vite"
import { readFile } from "node:fs/promises"

import { viteAliases } from "../vite-aliases.ts"

const check = process.argv.includes("--check")
for (const [entry, destination, fileName, name] of [
  [
    "app/utils/prototype-controls/browser-entry.mjs",
    "app/utils/prototype-controls/",
    "browser.js",
    "ReplicaControlsAdapter",
  ],
  [
    "app/features/install-replica-controls-bridge/index.ts",
    "app/features/install-replica-controls-bridge/",
    "bridge.js",
    "ReplicaBuildControlsBridge",
  ],
  [
    "app/features/build-controls/story-preview/index.ts",
    ".storybook/preview-fixtures/build-controls/",
    "controls.js",
    "ReplicaBuildControlsStory",
  ],
]) {
  const result = await build({
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    resolve: { alias: viteAliases },
    build: {
      write: !check,
      emptyOutDir: false,
      minify: true,
      outDir: new URL(`../${destination}`, import.meta.url).pathname,
      lib: {
        entry: new URL(`../${entry}`, import.meta.url).pathname,
        formats: ["iife"],
        name,
        fileName: () => fileName,
      },
    },
  })

  if (check) {
    const generated = (Array.isArray(result) ? result[0] : result).output.find(
      (entry) => entry.type === "chunk",
    ).code
    const existing = await readFile(
      new URL(`../${destination}${fileName}`, import.meta.url),
      "utf8",
    )
    if (generated !== existing)
      throw new Error(`The Controls bundle ${fileName} is stale. Run npm run controls:build.`)
  }
}
