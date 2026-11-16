import { randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
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

  it("uses repository defaults for the development API", () => {
    const repositoryRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}`,
    )
    const applicationRoot = resolve(repositoryRoot, "hub")
    onTestFinished(() => rm(repositoryRoot, { force: true, recursive: true }))

    expect(
      readLocalDevelopmentConfiguration(
        {
          HUB_LOCAL_MODE: "1",
          NODE_ENV: "development",
          RUNTIME_MODE: "api",
        },
        applicationRoot,
      ),
    ).toEqual({
      buildActionDirectory: resolve(repositoryRoot, "actions/build"),
      createPrototypeScript: resolve(repositoryRoot, "scripts/create-prototype-repo.sh"),
      enabled: true,
      root: resolve(applicationRoot, ".local/prototypes"),
      sourceRoot: repositoryRoot,
      temporaryRoot: tmpdir(),
    })
  })

  it("uses every configured local path for the on-demand worker", () => {
    const repositoryRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}`,
    )
    const applicationRoot = resolve(repositoryRoot, "hub")
    const prototypesRoot = resolve(repositoryRoot, "configured/prototypes")
    const buildActionRoot = resolve(repositoryRoot, "configured/build-action")
    const temporaryRoot = resolve(repositoryRoot, "configured/temporary")
    onTestFinished(() => rm(repositoryRoot, { force: true, recursive: true }))

    expect(
      readLocalDevelopmentConfiguration(
        {
          HUB_LOCAL_MODE: "1",
          LOCAL_BUILD_TEMPORARY_ROOT: temporaryRoot,
          LOCAL_PROTOTYPE_ROOT: prototypesRoot,
          LOCAL_REPLICA_BUILD_ACTION_ROOT: buildActionRoot,
          NODE_ENV: "development",
          RUNTIME_MODE: "on-demand",
        },
        applicationRoot,
      ),
    ).toEqual({
      buildActionDirectory: buildActionRoot,
      createPrototypeScript: resolve(repositoryRoot, "scripts/create-prototype-repo.sh"),
      enabled: true,
      root: prototypesRoot,
      sourceRoot: repositoryRoot,
      temporaryRoot,
    })
  })

  it("rejects local mode for a production runtime role", () => {
    const applicationRoot = resolve(
      `server/domains/local-development/.configuration-test-${randomUUID()}/hub`,
    )
    onTestFinished(() => rm(resolve(applicationRoot, ".."), { force: true, recursive: true }))

    expect(() =>
      readLocalDevelopmentConfiguration(
        {
          HUB_LOCAL_MODE: "true",
          NODE_ENV: "development",
          RUNTIME_MODE: "combined",
        },
        applicationRoot,
      ),
    ).toThrow(
      "HUB_LOCAL_MODE is available only for the development API or on-demand worker runtime.",
    )
  })

  it.each([
    ["LOCAL_PROTOTYPE_ROOT", "LOCAL_PROTOTYPE_ROOT"],
    ["LOCAL_REPLICA_BUILD_ACTION_ROOT", "LOCAL_REPLICA_BUILD_ACTION_ROOT"],
    ["LOCAL_BUILD_TEMPORARY_ROOT", "LOCAL_BUILD_TEMPORARY_ROOT"],
  ] as const)("rejects a relative %s", (setting, label) => {
    expect(() =>
      readLocalDevelopmentConfiguration({
        HUB_LOCAL_MODE: "true",
        NODE_ENV: "development",
        [setting]: "relative/path",
      }),
    ).toThrow(`${label} must be an absolute directory.`)
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
