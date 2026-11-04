import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it, onTestFinished } from "vitest"

import { createConfiguredArtifactStorage } from "."

describe("createConfiguredArtifactStorage()", () => {
  it("uses the explicitly supplied filesystem directory", async () => {
    const directory = resolve(`server/domains/artifacts/.storage-test-${randomUUID()}`)
    await mkdir(directory)
    onTestFinished(() => rm(directory, { recursive: true, force: true }))
    const storage = await createConfiguredArtifactStorage({
      ARTIFACT_STORAGE_PROVIDER: "filesystem",
      ARTIFACT_STORAGE_DIRECTORY: directory,
      UNRELATED_SETTING: "ignored",
    })

    expect(await storage.write("key", Uint8Array.of(0, 255))).toEqual({ status: "ok" })
    expect(await readFile(`${directory}/key`)).toEqual(Buffer.from([0, 255]))
  })

  it("rejects absent, invalid, incomplete, or mixed provider settings safely", async () => {
    for (const environment of [
      {},
      { ARTIFACT_STORAGE_PROVIDER: "" },
      { ARTIFACT_STORAGE_PROVIDER: "unknown" },
      { ARTIFACT_STORAGE_PROVIDER: "filesystem" },
      {
        ARTIFACT_STORAGE_PROVIDER: "filesystem",
        ARTIFACT_STORAGE_DIRECTORY: "/srv/artifacts",
        AZURE_STORAGE_ACCOUNT: "example",
      },
      {
        ARTIFACT_STORAGE_PROVIDER: "filesystem",
        ARTIFACT_STORAGE_DIRECTORY: "/srv/artifacts",
        AZURE_STORAGE_CONTAINER: "artifacts",
      },
      {
        ARTIFACT_STORAGE_PROVIDER: "filesystem",
        ARTIFACT_STORAGE_DIRECTORY: "/srv/artifacts",
        AZURE_CLIENT_ID: "",
      },
      {
        ARTIFACT_STORAGE_PROVIDER: "azure",
        AZURE_STORAGE_CONTAINER: "artifacts",
      },
      {
        ARTIFACT_STORAGE_PROVIDER: "azure",
        AZURE_STORAGE_ACCOUNT: "example",
      },
      {
        ARTIFACT_STORAGE_PROVIDER: "azure",
        AZURE_STORAGE_ACCOUNT: "example?secret",
        AZURE_STORAGE_CONTAINER: "artifacts",
      },
      {
        ARTIFACT_STORAGE_PROVIDER: "azure",
        AZURE_STORAGE_ACCOUNT: "example",
        AZURE_STORAGE_CONTAINER: "artifacts",
        ARTIFACT_STORAGE_DIRECTORY: "",
      },
    ]) {
      await expect(createConfiguredArtifactStorage(environment)).rejects.toThrow(
        "Artifact storage configuration is invalid.",
      )
    }
  })
})
