import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

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
        checkAssets({
          assets,
          build: () => writeFile(file, Buffer.alloc(1_000_001)),
        }),
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
        path.join(directory, "package.json"),
        JSON.stringify({
          private: true,
          scripts: { "extension:build": "node build.mjs" },
        }),
      )
      await writeFile(
        path.join(directory, "build.mjs"),
        'import { writeFileSync } from "node:fs"\nwriteFileSync(new URL("./extension with spaces/read-remote-branch/index.mjs", import.meta.url), "changed")\n',
      )

      assert.throws(
        () =>
          execFileSync(process.execPath, [script], {
            cwd: directory,
            encoding: "utf8",
            stdio: "pipe",
          }),
        /Extension assets differ after build.*read-remote-branch\/index\.mjs/s,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe("extension asset sources", () => {
  it("checks out Hub public SVGs with LF without changing binary asset bytes", async () => {
    const directory = path.join(process.cwd(), "storage", "replica-extension-tests", randomUUID())
    const repository = path.join(directory, "repository")
    const checkout = path.join(directory, "fresh checkout")
    const emptyConfig = path.join(directory, "empty.gitconfig")
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect width="1" height="1" />\n</svg>\n',
    )
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
      ),
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ATTR_NOSYSTEM: "1",
    }
    function git(...args) {
      return execFileSync(
        "git",
        ["-c", "core.autocrlf=true", "-c", "core.safecrlf=false", ...args],
        {
          cwd: repository,
          env,
          stdio: "pipe",
        },
      )
    }

    await mkdir(directory, { recursive: true })
    try {
      await mkdir(path.join(repository, "hub", "public"), { recursive: true })
      await writeFile(emptyConfig, "")
      try {
        await copyFile(
          fileURLToPath(new URL("../../../../hub/.gitattributes", import.meta.url)),
          path.join(repository, "hub", ".gitattributes"),
        )
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
      await writeFile(path.join(repository, "hub", "public", "avatar-placeholder.svg"), svg)
      await writeFile(path.join(repository, "hub", "public", "thumbnail.png"), binary)

      git("init", "--quiet", "--template=", ".")
      git("add", "--all")
      await mkdir(checkout)
      git("checkout-index", `--prefix=${checkout}${path.sep}`, "--all")

      assert.deepEqual(
        await readFile(path.join(checkout, "hub", "public", "thumbnail.png")),
        binary,
        "Git checkout must preserve binary public asset bytes",
      )
      assert.deepEqual(
        await readFile(path.join(checkout, "hub", "public", "avatar-placeholder.svg")),
        svg,
        "Git checkout must keep raw-imported public SVG text LF even with core.autocrlf=true",
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
