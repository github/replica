import { build } from "vite"
import { readFile, writeFile } from "node:fs/promises"

import { viteAliases } from "../vite-aliases.ts"

const check = process.argv.includes("--check")
for (const [entry, destination, fileName, name] of [
  [
    "client/utils/prototype-controls/browser-entry.mjs",
    "client/utils/prototype-controls/",
    "browser.js",
    "ReplicaControlsAdapter",
  ],
  [
    "client/features/install-replica-controls-bridge/index.ts",
    "client/features/install-replica-controls-bridge/",
    "bridge.js",
    "ReplicaBuildControlsBridge",
  ],
  [
    "client/features/build-controls/story-preview/index.ts",
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

const hosted = await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  resolve: { alias: viteAliases },
  build: {
    write: false,
    minify: true,
    lib: {
      entry: new URL(
        "../client/application/prototype-preview-bridge/install-hosted-bridge/index.ts",
        import.meta.url,
      ).pathname,
      formats: ["iife"],
      name: "ReplicaHostedPreviewBridge",
      fileName: () => "preview-bridge.js",
    },
  },
})
const hostedSource = (Array.isArray(hosted) ? hosted[0] : hosted).output.find(
  (entry) => entry.type === "chunk",
).code
const generatedPath = new URL("../server/assets/hosted-preview-bridge.ts", import.meta.url)
const generated = `// prettier-ignore\nexport const hostedPreviewBridgeSource = ${JSON.stringify(hostedSource)}\n`
if (check) {
  if ((await readFile(generatedPath, "utf8")) !== generated) {
    throw new Error("The hosted preview bridge is stale. Run npm run controls:build.")
  }
} else {
  await writeFile(generatedPath, generated)
}

const reviewSource = await readFile(
  new URL("../client/features/install-replica-preview-bridge/index.js", import.meta.url),
  "utf8",
)
const generatedReviewPath = new URL("../server/assets/hosted-review-bridge.ts", import.meta.url)
const generatedReview = `// prettier-ignore\nexport const hostedReviewBridgeSource = ${JSON.stringify(reviewSource)}\n`
if (check) {
  if ((await readFile(generatedReviewPath, "utf8")) !== generatedReview) {
    throw new Error("The hosted review bridge is stale. Run npm run controls:build.")
  }
} else {
  await writeFile(generatedReviewPath, generatedReview)
}
