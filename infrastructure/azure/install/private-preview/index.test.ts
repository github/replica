import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { DeploymentConfig, PrivatePreviewChoice } from "../../../installer/types.ts"
import type { DnsResolver } from "./dns/index.ts"
import { listingDeniedCondition } from "./plan/index.ts"
import { preparePrivatePreview } from "./index.ts"

const fake = vi.hoisted(() => ({
  terraform: undefined as undefined | ((options: { beforeApply?(): Promise<void> }) => unknown),
  lease: undefined as undefined | (() => unknown),
}))
vi.mock("../../../terraform/index.ts", () => ({
  terraformModule: (options: { beforeApply?(): Promise<void> }) => fake.terraform!(options),
}))
vi.mock("../lease/index.ts", () => ({ acquireLease: async () => fake.lease!() }))

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

interface Variables {
  reader: "absent" | "disabled" | "enabled"
  inline_enabled: boolean
  custom_hostname: string | null
  bind_custom_hostname: boolean
  writer_principal_id: string | null
  reader_secret: unknown
}

// What the private-preview Terraform state records before this run.
interface Current {
  reader: "absent" | "disabled" | "enabled"
  uncounted?: boolean
  inline?: boolean
  writer?: boolean
  boundHostname?: string
}

const subscriptionId = "00000000-0000-0000-0000-000000000001"
const hubPrincipal = "22222222-2222-4222-8222-222222222222"
const readerPrincipal = "33333333-3333-4333-8333-333333333333"
const lineage = "11111111-1111-4111-8111-111111111111"
const generated = "sample-hub-preview.example.eastus2.azurecontainerapps.io"
const storageAccountId = `/subscriptions/${subscriptionId}/resourceGroups/sample-hub-rg/providers/Microsoft.Storage/storageAccounts/samplehubhub`
const containerId = `${storageAccountId}/blobServices/default/containers/private-preview-artifacts`
const registryId = `/subscriptions/${subscriptionId}/resourceGroups/sample-hub-foundation/providers/Microsoft.ContainerRegistry/registries/sample`
const vaultId = `/subscriptions/${subscriptionId}/resourceGroups/sample-hub-foundation/providers/Microsoft.KeyVault/vaults/samplevault`
const readerSecret = {
  key_vault_id: vaultId,
  secret_id: "https://samplevault.vault.azure.net/secrets/private-preview-reader/1",
}
const generatedHub = {
  hub_application_origin: "https://sample-hub.example.eastus2.azurecontainerapps.io",
  runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" },
}
const customHub = { ...generatedHub, hub_application_origin: "https://replica.coreai.design" }
// Hub inputs saved by an earlier run that turned playback on.
const playingHub = {
  ...generatedHub,
  runtime_environment_variables: {
    HUB_TRUSTED_PROXY_HOPS: "1",
    HUB_PRIVATE_PREVIEW_ENABLED: "true",
    HUB_PRIVATE_PREVIEW_ORIGIN: `https://${generated}`,
    HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true",
  },
  runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
}
const on = (choice: Partial<PrivatePreviewChoice> = {}): PrivatePreviewChoice => ({
  reader: "on",
  inline: false,
  writerRepositoryIds: [],
  ...choice,
})
const removed: PrivatePreviewChoice = { reader: "removed", inline: false, writerRepositoryIds: [] }
const dnsReady: DnsResolver = {
  cname: async () => [generated],
  txt: async () => [["VERIFY123"]],
}

function stateSnapshot(current: Current | undefined) {
  if (!current) return { format_version: "1.0" }
  const resources: unknown[] = []
  if (current.reader !== "absent")
    resources.push({
      address: current.uncounted ? "azurerm_container_app.reader" : "azurerm_container_app.reader[0]",
      values: {
        name: "sample-hub-preview",
        ingress: current.reader === "enabled" ? [{ external_enabled: true }] : [],
        template: [{ container: [{ env: [{ name: "HUB_PRIVATE_PREVIEW_INLINE_ENABLED", value: String(Boolean(current.inline)) }] }] }],
      },
    })
  if (current.boundHostname)
    resources.push({ address: "azurerm_container_app_custom_domain.reader[0]", values: { name: current.boundHostname } })
  if (current.writer) resources.push({ address: "azurerm_role_assignment.writer[0]", values: {} })
  return { format_version: "1.0", values: { root_module: { resources } } }
}

const grant = (principalId: string, roleDefinitionName: string, scope: string, condition: string | null = null) => ({
  id: `${scope}/providers/Microsoft.Authorization/roleAssignments/${roleDefinitionName.replaceAll(" ", "-")}`,
  scope,
  principalId,
  roleDefinitionName,
  condition,
  conditionVersion: condition ? "2.0" : null,
})

async function fixture({
  choice,
  current,
  orphaned = false,
  openedLineage,
  unexpectedReaderGrant = false,
}: {
  choice?: PrivatePreviewChoice
  current?: Current
  orphaned?: boolean
  openedLineage?: string
  unexpectedReaderGrant?: boolean
}) {
  const directory = resolve(`.preview-prepare-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "sample-hub",
    owner: "sample-team",
    ...(choice && { privatePreview: choice }),
    azure: { subscriptionId, tenantId: subscriptionId, location: "eastus2", resourceGroup: "sample-hub-rg" },
  }
  let blob = current
    ? JSON.stringify({ version: 4, terraform_version: "1.13.0", serial: 3, lineage, outputs: {}, resources: [] })
    : undefined
  // What Azure has now; each apply replaces it with what the applied variables declare.
  const live = {
    reader: current?.reader ?? "absent",
    writer: Boolean(current?.writer),
    secret: current?.reader === "enabled",
    // Earlier wizard versions granted the reader without the listing-denied condition.
    unconditioned: Boolean(current?.uncounted),
    hostname: current?.boundHostname ?? null,
    bindings: new Map<string, string>(current?.boundHostname ? [[current.boundHostname, "SniEnabled"]] : []),
  }
  const applied: Variables[] = []
  const inits = vi.fn()
  fake.terraform = ({ beforeApply }) => ({
    init: inits,
    async rawState() {
      const state = JSON.parse(blob!) as Record<string, unknown>
      return openedLineage ? { ...state, lineage: openedLineage } : state
    },
    stateSnapshot: async () => stateSnapshot(current),
    async output() {
      const present = live.reader !== "absent"
      return {
        origin: live.reader === "enabled" ? `https://${live.hostname ?? generated}` : null,
        generated_hostname: present ? generated : null,
        custom_domain_verification_id: present ? "VERIFY123" : null,
      }
    },
    async apply(file: string) {
      await beforeApply?.()
      const variables = JSON.parse(await readFile(file, "utf8")) as Variables
      applied.push(variables)
      live.reader = variables.reader
      live.unconditioned = false
      live.writer = variables.writer_principal_id !== null
      live.secret = variables.reader === "enabled" && variables.reader_secret !== null
      live.hostname = variables.reader === "enabled" ? variables.custom_hostname : null
      for (const name of live.bindings.keys())
        if (name !== live.hostname || !variables.bind_custom_hostname) live.bindings.delete(name)
      if (live.hostname && variables.bind_custom_hostname && !live.bindings.has(live.hostname))
        live.bindings.set(live.hostname, "Disabled")
      const state = JSON.parse(blob!) as { serial: number }
      blob = JSON.stringify({ ...state, serial: state.serial + 1 })
    },
  })
  const leases: { verify: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; reportRetained: ReturnType<typeof vi.fn> }[] = []
  fake.lease = () => {
    const lease = { held: true, verify: vi.fn(), release: vi.fn(), reportRetained: vi.fn() }
    leases.push(lease)
    return lease
  }
  const azure = vi.fn(async (...args: string[]) => {
    const operation = args.slice(0, 3).join(" ")
    const value = (flag: string) => args[args.indexOf(flag) + 1]!
    if (operation === "storage blob exists") return JSON.stringify({ exists: blob !== undefined })
    if (operation === "storage blob download") {
      await writeFile(value("--file"), blob!)
      return ""
    }
    if (operation === "storage blob upload") {
      blob = await readFile(value("--file"), "utf8")
      return ""
    }
    if (operation === "group exists --name") return JSON.stringify(orphaned || current !== undefined)
    if (operation === "storage container-rm exists") return JSON.stringify({ exists: orphaned || current !== undefined })
    if (operation === "identity show --ids")
      return JSON.stringify(value("--ids").endsWith("/sample-hub-hub") ? hubPrincipal : readerPrincipal)
    if (operation === "role assignment list") {
      if (!args.includes("--assignee-object-id"))
        return JSON.stringify(
          live.writer ? [grant(hubPrincipal, "Replica sample-hub private preview writer", containerId, listingDeniedCondition)] : [],
        )
      const grants = []
      if (live.reader !== "absent")
        grants.push(
          grant(readerPrincipal, "AcrPull", registryId),
          grant(readerPrincipal, "Storage Blob Data Reader", containerId, live.unconditioned ? null : listingDeniedCondition),
        )
      if (live.secret)
        grants.push(grant(readerPrincipal, "Key Vault Secrets User", `${vaultId}/secrets/private-preview-reader`))
      if (unexpectedReaderGrant) grants.push(grant(readerPrincipal, "Storage Blob Data Contributor", storageAccountId))
      return JSON.stringify(grants)
    }
    if (operation === "containerapp show --name") return JSON.stringify({ latest: "reader--1", ready: "reader--1" })
    if (operation === "containerapp hostname list")
      return JSON.stringify([...live.bindings].map(([name, bindingType]) => ({ name, bindingType })))
    if (operation === "containerapp hostname bind") {
      live.bindings.set(value("--hostname"), "SniEnabled")
      return ""
    }
    throw new Error(`Unexpected Azure command: ${args.join(" ")}`)
  })
  const notice = vi.fn()
  const prepare = (inputs: Record<string, unknown>, resolver?: DnsResolver) =>
    preparePrivatePreview(
      { config, directory, run: vi.fn(), azure, env: {}, ui: { status: vi.fn(), notice, confirm: vi.fn(), wait: vi.fn() } },
      {
        image: `registry.azurecr.io/replica-hub@sha256:${"a".repeat(64)}`,
        foundation: { vault_id: vaultId, vault_url: "https://samplevault.vault.azure.net/", registry_id: registryId, registry_url: "registry.azurecr.io" },
        installation: {
          environment_id: "environment",
          resource_group: "sample-hub-rg",
          resource_group_id: "group",
          app_id: null,
          storage_account: "samplehubhub",
          storage_account_id: storageAccountId,
          postgres_server_id: "postgres",
          postgres_host: "postgres.example",
          url: null,
        },
        inputs,
        readerSecret: async () => readerSecret,
        lock: { verify: vi.fn() },
        resolver: resolver ?? { cname: async () => [], txt: async () => [] },
      },
    )
  const uploads = () => azure.mock.calls.filter((call) => call.slice(0, 3).join(" ") === "storage blob upload")
  return { prepare, applied, inits, leases, uploads }
}

describe("preparePrivatePreview", () => {
  it("leaves a default install without preview resources, Terraform, or Hub preview settings", async () => {
    const { prepare, inits, uploads } = await fixture({})

    const prepared = await prepare({
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1", HUB_PRIVATE_PREVIEW_ENABLED: "true" },
    })

    expect(prepared.inputs).toEqual({ runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1" } })
    await expect(prepared.finish()).resolves.toEqual([])
    expect(inits).not.toHaveBeenCalled()
    expect(uploads()).toEqual([])
  })

  it("blocks before Terraform when saved state is missing but preview resources exist", async () => {
    const { prepare, inits, uploads } = await fixture({ orphaned: true })

    await expect(prepare({})).rejects.toThrow(/missing, but private preview resources exist/)
    expect(inits).not.toHaveBeenCalled()
    expect(uploads()).toEqual([])
  })

  it("blocks before any apply when the backend opens a state other than the saved one", async () => {
    const { prepare, applied } = await fixture({ current: { reader: "disabled" }, openedLineage: randomUUID() })

    await expect(prepare({})).rejects.toThrow(/different state/)
    expect(applied).toEqual([])
  })

  it.each([
    ["Hub has no sign-in origin", {}, undefined, /sign-in settings/],
    ["the reader hostname is not under Hub's hostname", customHub, "preview.coreai.design", /must be a hostname under Hub's hostname/],
    ["Hub has a custom hostname but the reader does not", customHub, undefined, /needs a custom hostname/],
  ])("blocks turning on the reader before any change when %s", async (_, inputs, hostname, message) => {
    const { prepare, inits, uploads } = await fixture({ choice: on(hostname ? { hostname } : {}) })

    await expect(prepare(inputs)).rejects.toThrow(message)
    expect(inits).not.toHaveBeenCalled()
    expect(uploads()).toEqual([])
  })

  it("turns on the reader and Hub playback on a first opt-in with one apply", async () => {
    const { prepare, applied, uploads } = await fixture({ choice: on({ inline: true }) })

    const prepared = await prepare(generatedHub)
    await prepared.finish()

    expect(uploads()).toHaveLength(1)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ reader: "enabled", inline_enabled: true, reader_secret: readerSecret })
    expect(prepared.inputs).toEqual({
      ...generatedHub,
      runtime_environment_variables: {
        HUB_TRUSTED_PROXY_HOPS: "1",
        HUB_PRIVATE_PREVIEW_ENABLED: "true",
        HUB_PRIVATE_PREVIEW_ORIGIN: `https://${generated}`,
        HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true",
      },
      runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
    })
  })

  it("keeps an upgraded install's uncounted disabled reader disabled when the choice is off", async () => {
    const { prepare, applied } = await fixture({ current: { reader: "disabled", uncounted: true } })

    const prepared = await prepare(generatedHub)
    await prepared.finish()

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ reader: "disabled", inline_enabled: false, writer_principal_id: null, reader_secret: null })
    expect(prepared.inputs).toEqual(generatedHub)
  })

  it("keeps the reader for the current Hub when turning it off, then disables it after the release", async () => {
    const { prepare, applied } = await fixture({ current: { reader: "enabled", inline: true } })

    const prepared = await prepare(playingHub)

    expect(applied).toEqual([expect.objectContaining({ reader: "enabled", inline_enabled: true })])
    expect(prepared.inputs).toEqual({
      ...generatedHub,
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1", HUB_PRIVATE_PREVIEW_ENABLED: "false" },
      runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
    })

    await prepared.finish()

    expect(applied[1]).toMatchObject({ reader: "disabled", inline_enabled: false, reader_secret: null })
  })

  it("turns inline playback off in Hub before the reader stops offering it", async () => {
    const { prepare, applied } = await fixture({ choice: on(), current: { reader: "enabled", inline: true } })

    const prepared = await prepare(playingHub)

    expect(applied).toEqual([expect.objectContaining({ reader: "enabled", inline_enabled: true })])
    expect(prepared.inputs.runtime_environment_variables).toMatchObject({
      HUB_PRIVATE_PREVIEW_ENABLED: "true",
      HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "false",
    })

    await prepared.finish()

    expect(applied[1]).toMatchObject({ reader: "enabled", inline_enabled: false })
  })

  it("removes the reader and writer only after the release", async () => {
    const { prepare, applied } = await fixture({
      choice: removed,
      current: { reader: "enabled", writer: true },
    })
    const inputs = {
      ...playingHub,
      runtime_environment_variables: {
        ...playingHub.runtime_environment_variables,
        HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "true",
        HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: "123",
        HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: "private-preview-artifacts",
      },
    }

    const prepared = await prepare(inputs)

    expect(applied).toEqual([expect.objectContaining({ reader: "enabled", writer_principal_id: hubPrincipal })])
    expect(prepared.inputs.runtime_environment_variables).toEqual({
      HUB_TRUSTED_PROXY_HOPS: "1",
      HUB_PRIVATE_PREVIEW_ENABLED: "false",
    })

    await prepared.finish()

    expect(applied[1]).toMatchObject({ reader: "absent", writer_principal_id: null })
  })

  it("keeps Hub playback off and lists the DNS records until the custom hostname can be bound", async () => {
    const hostname = "preview.replica.coreai.design"
    const { prepare, applied } = await fixture({ choice: on({ hostname }), current: { reader: "disabled" } })

    const prepared = await prepare(customHub)
    const notes = (await prepared.finish()).join("\n")

    expect(applied).toEqual([expect.objectContaining({ reader: "enabled", custom_hostname: hostname, bind_custom_hostname: false })])
    expect(prepared.inputs).toEqual(customHub)
    expect(notes).toMatch(new RegExp(`CNAME\\s+${hostname}\\b.*${generated}`))
    expect(notes).toMatch(new RegExp(`TXT\\s+asuid\\.${hostname}\\b.*VERIFY123`))
  })

  it("binds the custom hostname once DNS is ready and turns on Hub playback with it", async () => {
    const hostname = "preview.replica.coreai.design"
    const { prepare, applied } = await fixture({ choice: on({ hostname }), current: { reader: "enabled" } })

    const prepared = await prepare(customHub, dnsReady)

    expect(applied).toEqual([expect.objectContaining({ custom_hostname: hostname, bind_custom_hostname: true })])
    expect(prepared.inputs.runtime_environment_variables).toMatchObject({
      HUB_PRIVATE_PREVIEW_ENABLED: "true",
      HUB_PRIVATE_PREVIEW_ORIGIN: `https://${hostname}`,
    })
  })

  it("blocks before any apply when the reader has a grant the wizard does not manage", async () => {
    const { prepare, applied, leases } = await fixture({
      current: { reader: "disabled" },
      unexpectedReaderGrant: true,
    })

    await expect(prepare(generatedHub)).rejects.toThrow(/unexpected grant/)
    expect(applied).toEqual([])
    expect(leases).toEqual([])
  })

  it("re-runs an unchanged enabled reader with one apply and nothing to remove afterwards", async () => {
    const { prepare, applied } = await fixture({ choice: on({ inline: true }), current: { reader: "enabled", inline: true } })

    const prepared = await prepare(playingHub)
    await prepared.finish()

    expect(applied).toHaveLength(1)
    expect(prepared.inputs).toEqual(playingHub)
  })
})
