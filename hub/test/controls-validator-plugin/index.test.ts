import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createServer, normalizePath } from "vite"
import { describe, expect, it, onTestFinished } from "vitest"

import {
  controlsValidatorModule,
  controlsValidatorPath,
  controlsValidatorPlugin,
} from "../../controls-validator-plugin"

async function createResolver() {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    appType: "custom",
    publicDir: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    plugins: [
      controlsValidatorPlugin(),
      {
        name: "test:validator-resolution",
        enforce: "pre",
        resolveId(source) {
          if (source === controlsValidatorModule) return "\0test:optimized-validator"
          if (source === "./controls-shape.cjs") return "\0test:raw-validator"
          return null
        },
      },
    ],
  })
  onTestFinished(() => server.close())
  return server.environments.client.pluginContainer
}

describe("controlsValidatorPlugin()", () => {
  it("uses the optimized validator for a native importer", async () => {
    const resolver = await createResolver()
    const importer = resolve(dirname(controlsValidatorPath), "controls-validation.mjs")

    const result = await resolver.resolveId("./controls-shape.cjs", `${importer}?v=1`)

    expect(result?.id).toBe("\0test:optimized-validator")
  })

  it("leaves another module's CommonJS import untouched", async () => {
    const resolver = await createResolver()
    const importer = normalizePath(resolve(dirname(controlsValidatorPath), "another-module.mjs"))

    const result = await resolver.resolveId("./controls-shape.cjs", importer)

    expect(result?.id).toBe("\0test:raw-validator")
  })
})
