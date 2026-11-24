import { describe, expect, it } from "vitest"

import { readPrivatePreviewWriterSettings } from "."

const environment = {
  ARTIFACT_STORAGE_PROVIDER: "azure",
  AZURE_STORAGE_ACCOUNT: "previewtest",
  AZURE_STORAGE_CONTAINER: "build-artifacts",
  AZURE_CLIENT_ID: "00000000-0000-4000-8000-000000000001",
  HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "true",
  HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: "9007199254740993",
  HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: "private-dist",
}

describe("readPrivatePreviewWriterSettings()", () => {
  it("keeps the exact GitHub repository ID and uses the runtime identity for the dedicated container", () => {
    expect(readPrivatePreviewWriterSettings(environment)).toEqual({
      repositoryId: "9007199254740993",
      storage: {
        provider: "azure-blob",
        accountUrl: "https://previewtest.blob.core.windows.net",
        container: "private-dist",
        managedIdentityClientId: environment.AZURE_CLIENT_ID,
      },
    })
  })

  it("does not need usable storage settings when publishing is disabled", () => {
    expect(readPrivatePreviewWriterSettings({})).toBeUndefined()
    expect(
      readPrivatePreviewWriterSettings({
        HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "false",
        HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: "ignored",
      }),
    ).toBeUndefined()
  })

  it.each([
    {
      condition: "no explicit opt-in",
      overrides: { HUB_PRIVATE_PREVIEW_WRITE_ENABLED: undefined },
    },
    {
      condition: "no repository ID",
      overrides: { HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: undefined },
    },
    {
      condition: "a noncanonical repository ID",
      overrides: { HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: "02001" },
    },
    { condition: "no destination", overrides: { HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: undefined } },
    {
      condition: "the source container as destination",
      overrides: { HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: environment.AZURE_STORAGE_CONTAINER },
    },
  ])("rejects $condition", ({ overrides }) => {
    expect(() => readPrivatePreviewWriterSettings({ ...environment, ...overrides })).toThrow()
  })
})
