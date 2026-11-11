import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("prototype index seed", () => {
  it("rejects unsafe configuration before initializing Prisma", () => {
    const script = fileURLToPath(new URL("./index.ts", import.meta.url))
    const result = spawnSync(process.execPath, [script, "00000000-0000-4000-8000-000000000001"], {
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "",
        DOTENV_CONFIG_OVERRIDE: "false",
      },
      encoding: "utf8",
      timeout: 10_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("The prototype seed requires a local development database.")
    expect(result.stderr).not.toContain("Set DATABASE_URL before importing the Prisma client.")
  }, 15_000)
})
