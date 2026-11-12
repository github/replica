import { randomUUID } from "node:crypto"
import { mkdir, rm, symlink } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { readLearningConfiguration } from "."

describe("readLearningConfiguration()", () => {
  it("provides no credential provider by default", async () => {
    const applicationRoot = resolve(`server/domains/learning/.root-test-${randomUUID()}`)
    onTestFinished(() => rm(applicationRoot, { force: true, recursive: true }))

    const configuration = await readLearningConfiguration({}, applicationRoot)

    expect(configuration.copilotCredentialProvider).toMatchObject({
      key: "unconfigured",
      configurationDigest: null,
    })
    await expect(configuration.copilotCredentialProvider.getCredential()).resolves.toBeNull()
  })

  it("rejects an environment token without explicit local authentication mode", async () => {
    const applicationRoot = resolve(`server/domains/learning/.root-test-${randomUUID()}`)
    onTestFinished(() => rm(applicationRoot, { force: true, recursive: true }))

    await expect(
      readLearningConfiguration(
        { REPLICA_COPILOT_TOKEN: "credential" },
        applicationRoot,
      ),
    ).rejects.toThrow(
      "REPLICA_COPILOT_AUTHENTICATION=environment-token is required when REPLICA_COPILOT_TOKEN is set.",
    )
  })

  it("rejects a learning root under the configured client directory", async () => {
    const applicationRoot = resolve(`server/domains/learning/.root-test-${randomUUID()}`)
    const clientDirectory = resolve(applicationRoot, "client-build")
    await mkdir(clientDirectory, { recursive: true })
    onTestFinished(() => rm(applicationRoot, { force: true, recursive: true }))

    await expect(
      readLearningConfiguration(
        {
          CLIENT_DIRECTORY: clientDirectory,
          REPLICA_LEARNING_ROOT: resolve(clientDirectory, "learning"),
        },
        applicationRoot,
      ),
    ).rejects.toThrow(
      "REPLICA_LEARNING_ROOT must be a dedicated private directory outside the public web root.",
    )
  })

  it("rejects a learning root under the public web root", async () => {
    const applicationRoot = resolve(`server/domains/learning/.root-test-${randomUUID()}`)
    await mkdir(resolve(applicationRoot, "public"), { recursive: true })
    onTestFinished(() => rm(applicationRoot, { force: true, recursive: true }))

    await expect(
      readLearningConfiguration(
        { REPLICA_LEARNING_ROOT: resolve(applicationRoot, "public", "learning") },
        applicationRoot,
      ),
    ).rejects.toThrow(
      "REPLICA_LEARNING_ROOT must be a dedicated private directory outside the public web root.",
    )
  })

  it("rejects a learning root reached through a symbolic link", async () => {
    const applicationRoot = resolve(`server/domains/learning/.root-test-${randomUUID()}`)
    const privateRoot = resolve(applicationRoot, "private")
    await mkdir(privateRoot, { recursive: true })
    await symlink(privateRoot, resolve(applicationRoot, "learning-link"))
    onTestFinished(() => rm(applicationRoot, { force: true, recursive: true }))

    await expect(
      readLearningConfiguration(
        { REPLICA_LEARNING_ROOT: resolve(applicationRoot, "learning-link", "state") },
        applicationRoot,
      ),
    ).rejects.toThrow(
      "REPLICA_LEARNING_ROOT must be a dedicated private directory outside the public web root.",
    )
  })
})
