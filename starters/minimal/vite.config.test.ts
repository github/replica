// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build, createServer, preview } from "vite"
import { expect, it } from "vitest"

const root = fileURLToPath(new URL("./", import.meta.url))

it("serves an ordinary app without Replica hooks in dev and preview", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "replica-starter-build-"))
  const config = {
    configFile: path.join(root, "vite.config.ts"),
    logLevel: "silent" as const,
    build: { outDir, emptyOutDir: true },
  }
  try {
    const dev = await createServer({ ...config, server: { host: "127.0.0.1", port: 0 } })
    await dev.listen()
    try {
      const address = dev.httpServer?.address()
      if (!address || typeof address === "string") throw new Error("Missing Vite address")
      const html = await (await fetch(`http://127.0.0.1:${address.port}`)).text()
      expect(html).not.toContain("__replica")
    } finally {
      await dev.close()
    }
    await build(config)
    const server = await preview({ ...config, preview: { host: "127.0.0.1", port: 0 } })
    try {
      const address = server.httpServer?.address()
      if (!address || typeof address === "string") throw new Error("Missing Vite address")
      expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).not.toContain(
        "__replica",
      )
    } finally {
      await server.close()
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}, 30_000)
