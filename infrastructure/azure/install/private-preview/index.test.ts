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
  hub_application_origin: string | null
  trusted_proxy_hops: number | null
}

// What the private-preview Terraform state records before this run.
interface Current {
  reader: "absent" | "disabled" | "enabled"
  uncounted?: boolean
  inline?: boolean
  writer?: boolean
  boundHostname?: string
  // The Hub settings an enabled reader was started with; defaults to generatedHub's.
  hubOrigin?: string
  hops?: number
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
        template: [{
          container: [{
            env: [
              { name: "HUB_PRIVATE_PREVIEW_INLINE_ENABLED", value: String(Boolean(current.inline)) },
              ...(current.reader === "enabled"
                ? [
                    { name: "HUB_APPLICATION_ORIGIN", value: current.hubOrigin ?? generatedHub.hub_application_origin },
                    { name: "PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS", value: String(current.hops ?? 1) },
                  ]
                : []),
            ],
          }],
        }],
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
  readyAfterChecks = 1,
  bindFailure,
  conditionDroppedOnApply = false,
  planBlocked = false,
}: {
  choice?: PrivatePreviewChoice
  current?: Current
  orphaned?: boolean
  openedLineage?: string
  unexpectedReaderGrant?: boolean
  // How many readiness checks see the latest revision not ready yet, plus one; Infinity never.
  readyAfterChecks?: number
  bindFailure?: "rejected" | "never bound"
  conditionDroppedOnApply?: boolean
  planBlocked?: boolean
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
    // Terraform grants the reader access to the secret it was given.
    secretScope: current?.reader === "enabled" ? `${vaultId}/secrets/private-preview-reader` : null,
    // Earlier wizard versions granted the reader without the listing-denied condition.
    unconditioned: Boolean(current?.uncounted),
    hostname: current?.boundHostname ?? null,
    bound: Boolean(current?.boundHostname),
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
        origin: live.reader === "enabled" ? `https://${live.bound && live.hostname ? live.hostname : generated}` : null,
        generated_hostname: present ? generated : null,
        custom_domain_verification_id: present ? "VERIFY123" : null,
      }
    },
    async apply(file: string) {
      if (planBlocked) throw new Error("Private preview plan blocked: synthetic.")
      await beforeApply?.()
      const variables = JSON.parse(await readFile(file, "utf8")) as Variables
      applied.push(variables)
      live.reader = variables.reader
      live.unconditioned = conditionDroppedOnApply
      live.writer = variables.writer_principal_id !== null
      const secret = variables.reader_secret as typeof readerSecret | null
      live.secretScope = variables.reader === "enabled" && secret
        ? `${secret.key_vault_id}/secrets/${secret.secret_id.split("/")[4]}`
        : null
      live.hostname = variables.reader === "enabled" ? variables.custom_hostname : null
      live.bound = Boolean(live.hostname && variables.bind_custom_hostname)
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
  let readinessChecks = 0
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
      if (live.secretScope) grants.push(grant(readerPrincipal, "Key Vault Secrets User", live.secretScope))
      if (unexpectedReaderGrant) grants.push(grant(readerPrincipal, "Storage Blob Data Contributor", storageAccountId))
      return JSON.stringify(grants)
    }
    if (operation === "containerapp show --name") {
      readinessChecks++
      return JSON.stringify({ latest: "reader--2", ready: readinessChecks >= readyAfterChecks ? "reader--2" : "reader--1" })
    }
    if (operation === "containerapp hostname list")
      return JSON.stringify([...live.bindings].map(([name, bindingType]) => ({ name, bindingType })))
    if (operation === "containerapp hostname bind") {
      if (bindFailure === "rejected") throw new Error("Certificate validation failed")
      if (bindFailure === "never bound") return ""
      live.bindings.set(value("--hostname"), "SniEnabled")
      return ""
    }
    throw new Error(`Unexpected Azure command: ${args.join(" ")}`)
  })
  const notice = vi.fn()
  const newSecret = vi.fn(async () => readerSecret)
  const status = vi.fn()
  const prepare = (inputs: Record<string, unknown>, resolver?: DnsResolver) =>
    preparePrivatePreview(
      { config, directory, run: vi.fn(), azure, env: {}, ui: { status, notice, confirm: vi.fn(), wait: vi.fn() } },
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
        readerSecret: newSecret,
        // Keep every case off the real ten-second polling delay.
        readiness: { attempts: 3, delayMs: 0 },
        lock: { verify: vi.fn() },
        resolver: resolver ?? { cname: async () => [], txt: async () => [] },
      },
    )
  const uploads = () => azure.mock.calls.filter((call) => call.slice(0, 3).join(" ") === "storage blob upload")
  const readiness = () => readinessChecks
  return { prepare, applied, inits, leases, uploads, azure, notice, newSecret, status, readiness }
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

  it("reuses the reader secret Hub already references instead of creating another", async () => {
    const savedSecret = {
      key_vault_id: vaultId,
      secret_id: "https://samplevault.vault.azure.net/secrets/earlier-reader-secret/1",
    }
    const inputs = { ...generatedHub, runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: savedSecret } }
    const { prepare, applied, newSecret } = await fixture({ choice: on(), current: { reader: "disabled" } })

    // The fake grants access only on the applied secret, so the grant check passes only for that scope.
    const prepared = await prepare(inputs)
    await prepared.finish()

    expect(newSecret).not.toHaveBeenCalled()
    expect(applied).toEqual([expect.objectContaining({ reader: "enabled", reader_secret: savedSecret })])
    expect(prepared.inputs.runtime_secret_references).toEqual({ HUB_PRIVATE_PREVIEW_READER_SECRET: savedSecret })
    expect(prepared.inputs.runtime_environment_variables).toMatchObject({ HUB_PRIVATE_PREVIEW_ENABLED: "true" })
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

  it("binds a hostname before the release and turns on playback in one run when Hub does not use the reader yet", async () => {
    const hostname = "preview.replica.coreai.design"
    const { prepare, applied } = await fixture({ choice: on({ hostname }), current: { reader: "enabled" } })

    const prepared = await prepare(customHub, dnsReady)
    await prepared.finish()

    expect(applied).toEqual([expect.objectContaining({ custom_hostname: hostname, bind_custom_hostname: true })])
    expect(prepared.inputs.runtime_environment_variables).toMatchObject({
      HUB_PRIVATE_PREVIEW_ENABLED: "true",
      HUB_PRIVATE_PREVIEW_ORIGIN: `https://${hostname}`,
    })
  })

  it("keeps the generated reader origin Hub uses and binds a new hostname only after the release", async () => {
    const hostname = "preview.replica.coreai.design"
    const { prepare, applied, azure } = await fixture({
      choice: on({ hostname }),
      current: { reader: "enabled", hubOrigin: customHub.hub_application_origin },
    })
    const inputs = {
      ...customHub,
      runtime_environment_variables: {
        HUB_TRUSTED_PROXY_HOPS: "1",
        HUB_PRIVATE_PREVIEW_ENABLED: "true",
        HUB_PRIVATE_PREVIEW_ORIGIN: `https://${generated}`,
        HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "false",
      },
      runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
    }
    const binds = () => azure.mock.calls.filter((call) => call.slice(0, 3).join(" ") === "containerapp hostname bind")

    const prepared = await prepare(inputs, dnsReady)

    expect(applied).toEqual([expect.objectContaining({ custom_hostname: null, bind_custom_hostname: false })])
    expect(binds()).toEqual([])
    expect(prepared.inputs).toEqual({
      ...customHub,
      runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1", HUB_PRIVATE_PREVIEW_ENABLED: "false" },
      runtime_secret_references: { HUB_PRIVATE_PREVIEW_READER_SECRET: readerSecret },
    })

    const notes = (await prepared.finish()).join("\n")

    expect(applied[1]).toMatchObject({ custom_hostname: hostname, bind_custom_hostname: true })
    expect(binds()).toHaveLength(1)
    expect(notes).toContain(`moves to https://${hostname}`)
  })

  it("keeps the Hub settings the reader was started with until the release, then applies Hub's saved ones", async () => {
    const { prepare, applied } = await fixture({
      choice: on({ inline: true }),
      current: { reader: "enabled", inline: true, hubOrigin: "https://earlier-hub.example.eastus2.azurecontainerapps.io", hops: 2 },
    })

    const prepared = await prepare(playingHub)

    expect(applied).toEqual([expect.objectContaining({
      hub_application_origin: "https://earlier-hub.example.eastus2.azurecontainerapps.io",
      trusted_proxy_hops: 2,
    })])
    expect(prepared.inputs.runtime_environment_variables).toEqual({
      HUB_TRUSTED_PROXY_HOPS: "1",
      HUB_PRIVATE_PREVIEW_ENABLED: "false",
    })

    const notes = (await prepared.finish()).join("\n")

    expect(applied[1]).toMatchObject({ hub_application_origin: playingHub.hub_application_origin, trusted_proxy_hops: 1 })
    expect(applied).toHaveLength(2)
    expect(notes).toMatch(/Hub playback stays off; run Update again/)
  })

  it("keeps Hub playback off when the reader revision is still not ready after every check", async () => {
    const { prepare, readiness } = await fixture({ choice: on(), readyAfterChecks: Infinity })

    const prepared = await prepare(generatedHub)
    const notes = (await prepared.finish()).join("\n")

    expect(readiness()).toBe(3)
    expect(prepared.inputs).toEqual(generatedHub)
    expect(notes).toMatch(/revision is not ready/)
  })

  it("waits for the reader revision and turns on Hub playback once it is ready", async () => {
    const { prepare, readiness, status } = await fixture({ choice: on(), readyAfterChecks: 2 })

    const prepared = await prepare(generatedHub)

    expect(readiness()).toBe(2)
    expect(status).toHaveBeenCalledWith(expect.stringMatching(/^Waiting for the reader revision/))
    expect(prepared.inputs.runtime_environment_variables).toMatchObject({ HUB_PRIVATE_PREVIEW_ENABLED: "true" })
  })

  it.each(["rejected", "never bound"] as const)(
    "keeps Hub playback off when the certificate binding is %s",
    async (bindFailure) => {
      const hostname = "preview.replica.coreai.design"
      const { prepare, notice } = await fixture({ choice: on({ hostname }), current: { reader: "enabled" }, bindFailure })

      const prepared = await prepare(customHub, dnsReady)
      const notes = (await prepared.finish()).join("\n")

      expect(prepared.inputs).toEqual(customHub)
      expect(notes).toContain(`certificate for ${hostname} is not bound yet`)
      expect(notes).not.toMatch(/moves to/)
      expect(notice).toHaveBeenCalledWith("warning", expect.stringMatching(new RegExp(`${hostname}.*certificate|certificate.*${hostname}`)))
    },
  )

  it("releases the release lock when the plan is blocked before anything is applied", async () => {
    const { prepare, applied, leases } = await fixture({ current: { reader: "disabled" }, planBlocked: true })

    await expect(prepare(generatedHub)).rejects.toThrow(/plan blocked/)

    expect(applied).toEqual([])
    expect(leases).toHaveLength(1)
    expect(leases[0]!.release).toHaveBeenCalledOnce()
  })

  it("stops before the Hub release and keeps the release lock when a grant is wrong after apply", async () => {
    const { prepare, applied, leases } = await fixture({ current: { reader: "disabled" }, conditionDroppedOnApply: true })

    await expect(prepare(generatedHub)).rejects.toThrow(/does not deny blob listing/)

    expect(applied).toHaveLength(1)
    expect(leases).toHaveLength(1)
    expect(leases[0]!.release).not.toHaveBeenCalled()
    expect(leases[0]!.reportRetained).toHaveBeenCalled()
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
