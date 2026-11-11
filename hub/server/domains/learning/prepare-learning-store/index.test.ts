import { randomUUID } from "node:crypto"
import { readFile, rm, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { prepareLearningStore } from "."

describe("prepareLearningStore()", () => {
  it("creates a private repository directory and configuration without persisting product data", async () => {
    const applicationRoot = resolve(`server/domains/learning/.store-test-${randomUUID()}`)
    const root = resolve(applicationRoot, "learning")
    const repositoryKey = randomUUID()
    onTestFinished(() => rm(applicationRoot, { force: true, recursive: true }))

    const result = await prepareLearningStore({
      applicationRoot,
      repositoryKey,
      repositoryScope: "github.com/repositories/replica",
      root,
    })

    expect(result).toEqual({
      directory: resolve(root, "repositories", repositoryKey),
      repositoryScope: "github.com/repositories/replica",
    })
    expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
    expect((await stat(resolve(result.directory, "config.json"))).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(resolve(result.directory, "config.json"), "utf8"))).toEqual({
      schemaVersion: "replica.learning-config/v1",
      consolidation: {
        options: {
          signals: ["visual_quality", "accessibility", "usability", "content", "interaction"],
        },
      },
    })
    expect(await readFile(resolve(result.directory, "config.json"), "utf8")).not.toContain(
      "github.com/repositories/replica",
    )
  })
})
