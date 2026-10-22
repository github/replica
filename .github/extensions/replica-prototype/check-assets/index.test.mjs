import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"

import { checkAssets } from "./index.mjs"

describe("checkAssets()", () => {
  it("enforces the installer's per-file limit, not an aggregate limit", async () => {
    const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(directory, { recursive: true })
    const assets = pathToFileURL(`${directory}/`)
    const file = path.join(directory, "renderer.js")
    try {
      await writeFile(file, Buffer.alloc(1_000_000))
      await writeFile(path.join(directory, "renderer.css"), Buffer.alloc(600_000))
      await checkAssets({ assets, build: () => undefined })
      await assert.rejects(
        checkAssets({ assets, build: () => writeFile(file, Buffer.alloc(1_000_001)) }),
        /1,000,000 bytes per file: renderer\.js \(1000001 bytes\)/,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("detects missing generated files even when they were empty", async () => {
    const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(directory, { recursive: true })
    const assets = pathToFileURL(`${directory}/`)
    const file = path.join(directory, "index.d.mts")
    try {
      await writeFile(file, "")
      await assert.rejects(checkAssets({ assets, build: () => rm(file) }), /index\.d\.mts/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("detects changed, missing, and unexpected generated files", async () => {
    const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(directory, { recursive: true })
    const assets = pathToFileURL(`${directory}/`)
    try {
      const file = path.join(directory, "renderer.js")
      await writeFile(file, "original")
      await checkAssets({ assets, build: () => undefined })

      await assert.rejects(
        checkAssets({ assets, build: () => writeFile(file, "changed") }),
        /changed, missing, or unexpected.*renderer\.js/,
      )
      await assert.rejects(checkAssets({ assets, build: () => rm(file) }), /renderer\.js/)
      await assert.rejects(
        checkAssets({
          assets,
          build: () => writeFile(path.join(directory, "extra.css"), ""),
        }),
        /extra\.css/,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it("checks generated Node modules outside browser assets from a path with spaces", async () => {
    const directory = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    const extension = path.join(directory, "extension with spaces")
    const scriptDirectory = path.join(extension, "check-assets")
    const assetFile = path.join(extension, "read-remote-branch", "index.mjs")
    const script = path.join(scriptDirectory, "index.mjs")
    await mkdir(scriptDirectory, { recursive: true })
    await mkdir(path.dirname(assetFile), { recursive: true })
    try {
      await copyFile(new URL("./index.mjs", import.meta.url), script)
      await writeFile(assetFile, "original")
      await writeFile(
        path.join(directory, "npm"),
        '#!/bin/sh\nprintf "%s" changed > "$TEST_ASSET_PATH"\n',
        { mode: 0o755 },
      )

      assert.throws(
        () =>
          execFileSync(process.execPath, [script], {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${directory}${path.delimiter}${process.env.PATH}`,
              TEST_ASSET_PATH: assetFile,
            },
            stdio: "pipe",
          }),
        /Extension assets differ after build.*read-remote-branch\/index\.mjs/s,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
