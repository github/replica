import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"

import { describe, expect, it, vi } from "vitest"
import { createServer, normalizePath, type Plugin, type UserConfig, type ViteDevServer } from "vite"

vi.mock("../vite-aliases.ts", () => ({ viteAliases: {} }))

import config from "./main"

describe("Storybook viteFinal()", () => {
  it("serves the source controls validator as browser-compatible ESM", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
    await mkdir(join(root, ".local"), { recursive: true })
    const cacheDir = await mkdtemp(join(root, ".local", "storybook-controls-cache-"))
    let server: ViteDevServer | undefined
    try {
      server = await createServer(
        config.viteFinal({
          configFile: false,
          root,
          cacheDir,
          logLevel: "silent",
          server: {
            host: "127.0.0.1",
            port: 0,
            fs: { allow: [resolve(root, ".."), cacheDir] },
          },
          optimizeDeps: { entries: [], noDiscovery: true },
        }),
      )
      await server.listen()
      const address = server.httpServer?.address()
      if (!address || typeof address === "string")
        throw new Error("Vite did not start an HTTP server.")
      const origin = `http://127.0.0.1:${address.port}`
      const validationFile = resolve(
        root,
        "app/javascript/utils/prototype-controls/controls-validation.mjs",
      )
      const response = await fetch(
        `${origin}/@fs/${normalizePath(validationFile)}?v=cache-suffixed-importer`,
      )
      expect(response.ok).toBe(true)
      const source = await response.text()
      const optimizedImport = source.match(
        /from "([^"]*\/deps\/replica-controls-validator\.js[^"]*)"/,
      )?.[1]
      expect(optimizedImport).toBeDefined()
      if (!optimizedImport) throw new Error("The validator was served without CommonJS conversion.")
      const dependency = await fetch(new URL(optimizedImport, origin))
      expect(dependency.ok).toBe(true)
      expect(await dependency.text()).toContain("export default")
    } finally {
      await server?.close()
      await rm(cacheDir, { recursive: true })
    }
  }, 15_000)

  it("keeps standalone asset paths without removing unrelated Vite plugins", () => {
    const viteConfig: UserConfig = {
      base: "/vite/",
      plugins: [[{ name: "example:assets" }], { name: "vite:react-babel" }],
    }
    const finalConfig = config.viteFinal(viteConfig)
    const plugins = finalConfig.plugins as unknown as (Plugin | Plugin[])[]
    const pluginNames = plugins.flat().map((plugin) => plugin.name)

    expect(finalConfig.base).toBe("./")
    expect(pluginNames).toContain("vite:react-babel")
    expect(pluginNames).toContain("example:assets")
  })
})
