import { describe, expect, it } from "vitest"

import { checkPrivatePreviewChoice, hubPreviewInputs, sameSiteHosts, type HubPreviewInputs } from "./index.ts"

const readerSecret = {
  key_vault_id: "/subscriptions/sample/resourceGroups/sample/providers/Microsoft.KeyVault/vaults/sample",
  secret_id: "https://sample.vault.azure.net/secrets/private-preview-reader/1",
}
const playback = { origin: "https://preview.replica.example.com", inline: true }

describe("hubPreviewInputs", () => {
  it("adds no private preview settings when everything stays off", () => {
    const inputs = { runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" } }

    expect(hubPreviewInputs(inputs, { writerRepositoryIds: [] })).toEqual(inputs)
  })

  it("turns on playback with the reader origin, inline setting, and shared secret", () => {
    const next = hubPreviewInputs({}, { playback, readerSecret, writerRepositoryIds: [] })

    expect(next).toEqual({
      runtime_environment_variables: {
        HUB_PRIVATE_PREVIEW_ENABLED: "true",
        HUB_PRIVATE_PREVIEW_ORIGIN: "https://preview.replica.example.com",
        HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true",
      },
      runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
    })
  })

  it("keeps the reader secret reference and turns playback off after it was on", () => {
    const enabled = hubPreviewInputs({}, { playback, readerSecret, writerRepositoryIds: [] })

    expect(hubPreviewInputs(enabled, { writerRepositoryIds: [] })).toEqual({
      runtime_environment_variables: { HUB_PRIVATE_PREVIEW_ENABLED: "false" },
      runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
    })
  })

  it("replaces manually saved private preview values and keeps other settings", () => {
    const inputs = {
      runtime_environment_variables: {
        HUB_TRUSTED_PROXY_HOPS: "1",
        HUB_PRIVATE_PREVIEW_ORIGIN: "https://manual.example.com",
        HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "true",
        HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: "999",
      },
    }

    expect(hubPreviewInputs(inputs, { writerRepositoryIds: [] })).toEqual({
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" },
    })
  })

  it("blocks a wizard-owned setting saved as a Key Vault reference", () => {
    const inputs = { runtime_secret_references: { HUB_PRIVATE_PREVIEW_ORIGIN: readerSecret } }

    expect(() => hubPreviewInputs(inputs, { writerRepositoryIds: [] })).toThrow(/Key Vault references/)
  })

  it("turns on the writer for the chosen repositories and container", () => {
    const next = hubPreviewInputs<HubPreviewInputs>({}, { writerRepositoryIds: ["123", "456"] })

    expect(next.runtime_environment_variables).toEqual({
      HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "true",
      HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: "123,456",
      HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: "private-preview-artifacts",
    })
    expect(next.runtime_secret_references).toBeUndefined()
  })
})

describe("sameSiteHosts", () => {
  it.each([
    { name: "a reader under Hub's hostname", hub: "replica.coreai.design", reader: "preview.replica.coreai.design", expected: true },
    { name: "two generated Container Apps hostnames", hub: "hub.example.eastus2.azurecontainerapps.io", reader: "reader.example.eastus2.azurecontainerapps.io", expected: true },
    { name: "a sibling of Hub's hostname", hub: "replica.coreai.design", reader: "preview.coreai.design", expected: false },
    { name: "a hostname that only ends with Hub's text", hub: "replica.coreai.design", reader: "previewreplica.coreai.design", expected: false },
    { name: "Hub's own hostname", hub: "replica.coreai.design", reader: "replica.coreai.design", expected: false },
  ])("returns $expected for $name", ({ hub, reader, expected }) => {
    expect(sameSiteHosts(hub, reader)).toBe(expected)
  })
})

describe("checkPrivatePreviewChoice", () => {
  const on = { reader: "on", hostname: "preview.replica.coreai.design" }
  const github: HubPreviewInputs = {
    hub_application_origin: "https://replica.coreai.design",
    github_app_id: "123",
    github_client_id: "Iv23sample",
    github_app_installation_id: "456",
    github_provider_revision: 2,
    runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" },
    runtime_secret_references: {
      GITHUB_APP_PRIVATE_KEY_BASE64: readerSecret,
      GITHUB_WEBHOOK_SECRET: readerSecret,
      GITHUB_CLIENT_SECRET: readerSecret,
    },
  }
  const withoutSecret = (name: string): HubPreviewInputs => {
    const { [name]: _, ...references } = github.runtime_secret_references!
    return { ...github, runtime_secret_references: references }
  }

  it.each([
    ["complete GitHub sign-in", github],
    ["local sign-in in the environment", {
      hub_application_origin: "https://replica.coreai.design",
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1", HUB_LOCAL_SIGN_IN: "true" },
    }],
    ["local sign-in as a Key Vault reference", {
      hub_application_origin: "https://replica.coreai.design",
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" },
      runtime_secret_references: { HUB_LOCAL_SIGN_IN: readerSecret },
    }],
  ] as [string, HubPreviewInputs][])("accepts On with %s", (_, inputs) => {
    expect(() => checkPrivatePreviewChoice(on, inputs)).not.toThrow()
  })

  it.each([
    ["no webhook secret", withoutSecret("GITHUB_WEBHOOK_SECRET")],
    ["no provider revision", { ...github, github_provider_revision: undefined }],
    ["local sign-in turned off", {
      hub_application_origin: "https://replica.coreai.design",
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1", HUB_LOCAL_SIGN_IN: "false" },
    }],
  ] as [string, HubPreviewInputs][])("rejects On with incomplete sign-in: %s", (_, inputs) => {
    expect(() => checkPrivatePreviewChoice(on, inputs)).toThrow(/sign-in settings/)
  })

  it.each(["off", "removed"])("rejects a wizard-owned Key Vault reference even when the reader is %s", (reader) => {
    const inputs = { runtime_secret_references: { HUB_PRIVATE_PREVIEW_ENABLED: readerSecret } }

    expect(() => checkPrivatePreviewChoice({ reader }, inputs)).toThrow(/Key Vault references for HUB_PRIVATE_PREVIEW_ENABLED/)
  })

  it("rejects changing or removing the hostname of a saved reader that is on", () => {
    const generatedHub = { ...github, hub_application_origin: "https://hub.example.eastus2.azurecontainerapps.io" }

    expect(() => checkPrivatePreviewChoice({ reader: "on", hostname: "other.replica.coreai.design" }, github, on))
      .toThrow(/Changing or removing its hostname/)
    expect(() => checkPrivatePreviewChoice({ reader: "on" }, generatedHub, on)).toThrow(/Changing or removing its hostname/)
    expect(() => checkPrivatePreviewChoice(on, github, on)).not.toThrow()
    expect(() => checkPrivatePreviewChoice({ reader: "on", hostname: "other.replica.coreai.design" }, github, { ...on, reader: "off" }))
      .not.toThrow()
  })
})
