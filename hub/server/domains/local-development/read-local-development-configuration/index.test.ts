import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { readLocalDevelopmentConfiguration } from "."

describe("readLocalDevelopmentConfiguration()", () => {
  it("keeps local development disabled unless it is explicitly selected", () => {
    const applicationRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}/hub`,
    )
    onTestFinished(() => rm(resolve(applicationRoot, ".."), { force: true, recursive: true }))
    expect(readLocalDevelopmentConfiguration({ NODE_ENV: "development" }, applicationRoot)).toEqual(
      { enabled: false },
    )
  })

  it("rejects local mode outside development instead of relaxing production startup", () => {
    const applicationRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}/hub`,
    )
    onTestFinished(() => rm(resolve(applicationRoot, ".."), { force: true, recursive: true }))
    expect(() =>
      readLocalDevelopmentConfiguration(
        { HUB_LOCAL_MODE: "1", NODE_ENV: "production" },
        applicationRoot,
      ),
    ).toThrow("HUB_LOCAL_MODE is available only when NODE_ENV=development.")
  })

  it("uses the configured private prototype root and the repository's shared tooling", () => {
    const repositoryRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}`,
    )
    const applicationRoot = resolve(repositoryRoot, "hub")
    const prototypesRoot = resolve(applicationRoot, ".local/prototypes")
    onTestFinished(() => rm(repositoryRoot, { force: true, recursive: true }))

    expect(
      readLocalDevelopmentConfiguration(
        {
          HUB_LOCAL_MODE: "1",
          LOCAL_PROTOTYPE_ROOT: prototypesRoot,
          NODE_ENV: "development",
        },
        applicationRoot,
      ),
    ).toEqual({
      buildActionDirectory: resolve(repositoryRoot, "actions/build"),
      createPrototypeScript: resolve(repositoryRoot, "scripts/create-prototype-repo.sh"),
      enabled: true,
      root: prototypesRoot,
      sourceRoot: repositoryRoot,
    })
  })

  it("rejects a prototype root inside Hub production storage", () => {
    const repositoryRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}`,
    )
    onTestFinished(() => rm(repositoryRoot, { force: true, recursive: true }))

    expect(() =>
      readLocalDevelopmentConfiguration(
        {
          HUB_LOCAL_MODE: "true",
          LOCAL_PROTOTYPE_ROOT: resolve(repositoryRoot, "hub/storage/prototypes"),
          NODE_ENV: "development",
        },
        resolve(repositoryRoot, "hub"),
      ),
    ).toThrow(
      "LOCAL_PROTOTYPE_ROOT must be a dedicated directory separate from Hub production data.",
    )
  })
})
