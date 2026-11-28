import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"

import { keepPrivatePreview, type Run } from "./index.ts"

const subscriptionId = "00000000-0000-0000-0000-000000000001"
const lineage = "11111111-1111-4111-8111-111111111111"
const keyVaultId = `/subscriptions/${subscriptionId}/resourceGroups/sample-hub-foundation/providers/Microsoft.KeyVault/vaults/samplevault`
const secretUrl = `https://samplevault.vault.azure.net/secrets/private-preview-reader/${"b".repeat(32)}`
const oldImage = `example.azurecr.io/hub@sha256:${"a".repeat(64)}`
const newImage = `example.azurecr.io/hub@sha256:${"c".repeat(64)}`
const hubOrigin = "https://replica.coreai.design"
const readerOrigin = "https://preview.replica.coreai.design"
const writerPrincipal = "22222222-2222-4222-8222-222222222222"

let directory: string
beforeEach(() => {
  directory = resolve(import.meta.dirname, `.keep-preview-test-${randomUUID()}`)
  mkdirSync(directory, { mode: 0o700 })
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

// What the running Hub app has from the last setup Update that turned playback and publishing on.
const playingHub = {
  HUB_PRIVATE_PREVIEW_ENABLED: "true",
  HUB_PRIVATE_PREVIEW_ORIGIN: readerOrigin,
  HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true",
  HUB_PRIVATE_PREVIEW_WRITE_ENABLED: "true",
  HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID: "123,456",
  HUB_PRIVATE_PREVIEW_WRITE_CONTAINER: "private-preview-artifacts",
}

function readerEnvironment(overrides: Record<string, string> = {}) {
  return Object.entries({
    HUB_PRIVATE_PREVIEW_ENABLED: "true",
    HUB_PRIVATE_PREVIEW_ORIGIN: readerOrigin,
    HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "true",
    HUB_APPLICATION_ORIGIN: hubOrigin,
    PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS: "1",
    ...overrides,
  }).map(([name, value]) => ({ name, value }))
}

function readerApp(image: string, { ingress = true, env = readerEnvironment() } = {}) {
  return {
    template: [{ container: [{ name: "reader", image, env }] }],
    ingress: ingress ? [{ external_enabled: true, target_port: 3002 }] : [],
    secret: ingress ? [{ name: "reader-secret", key_vault_secret_id: secretUrl }] : [],
    registry: [{ server: "example.azurecr.io" }],
    identity: [{ type: "UserAssigned" }],
    workload_profile_name: "Consumption",
  }
}

const update = (address: string, before: unknown, after: unknown) => ({
  address,
  change: { actions: ["update"], before, after },
})

function scenario({
  hub = playingHub as Record<string, string>,
  hubSecret = secretUrl as string | null,
  stateExists = true,
  reader = readerApp(oldImage),
  precount = false,
  openedLineage = lineage,
  plan,
  applyFails = false,
  supplied = {} as Record<string, string>,
}: {
  hub?: Record<string, string>
  hubSecret?: string | null
  stateExists?: boolean
  reader?: ReturnType<typeof readerApp> | null
  precount?: boolean
  openedLineage?: string
  plan?: { resource_changes: unknown[] }
  applyFails?: boolean
  supplied?: Record<string, string>
} = {}) {
  const variablesPath = join(directory, "hub.tfvars.json")
  writeFileSync(variablesPath, JSON.stringify({
    subscription_id: subscriptionId,
    name: "sample-hub",
    owner: "sample-team",
    location: "eastus2",
    resource_group_name: "sample-hub-rg",
    acr_id: `/subscriptions/${subscriptionId}/resourceGroups/sample-hub-foundation/providers/Microsoft.ContainerRegistry/registries/example`,
    image: newImage,
    hub_application_origin: hubOrigin,
    runtime_environment_variables: { HUB_TRUSTED_PROXY_HOPS: "1", PUBLIC_SETTING: "kept", ...supplied },
    runtime_secret_references: {},
  }), { mode: 0o600 })
  const savedState = JSON.stringify({ version: 4, terraform_version: "1.13.0", serial: 7, lineage, outputs: {}, resources: [] })
  const resources = [
    ...["azurerm_resource_group.reader", "azurerm_user_assigned_identity.reader", "azurerm_storage_container.reader"]
      .map((address) => ({ address, values: {} })),
    ...(reader ? [{ address: precount ? "azurerm_container_app.reader" : "azurerm_container_app.reader[0]", values: reader }] : []),
    { address: "azurerm_container_app_custom_domain.reader[0]", values: { name: "preview.replica.coreai.design" } },
    { address: "azurerm_role_assignment.writer[0]", values: { principal_id: writerPrincipal } },
  ]
  const imageOnly = reader ? { resource_changes: [update("azurerm_container_app.reader[0]", reader, readerApp(newImage, {
    ingress: reader.ingress.length > 0,
    env: reader.template[0]!.container[0]!.env,
  }))] } : { resource_changes: [] }
  const commands: string[][] = []
  const planVariables: Record<string, unknown>[] = []
  const logs: string[] = []
  const run: Run = async (executable, args) => {
    commands.push([executable, ...args])
    if (executable === "az") {
      const operation = args.slice(0, 4).join(" ")
      if (operation.startsWith("containerapp list"))
        return JSON.stringify([{
          env: [
            ...Object.entries(hub).map(([name, value]) => ({ name, value })),
            {
              name: "AZURE_KEY_VAULT_SECRET_REFERENCES",
              value: JSON.stringify({ OTHER_SECRET: "https://samplevault.vault.azure.net/secrets/other", ...(hubSecret && { HUB_PRIVATE_PREVIEW_READER_SECRET: hubSecret }) }),
            },
          ],
        }])
      if (operation.startsWith("storage blob exists")) return JSON.stringify({ exists: stateExists })
      if (operation.startsWith("storage blob download")) {
        writeFileSync(args[args.indexOf("--file") + 1]!, savedState)
        return ""
      }
      if (operation === "storage blob lease acquire" || operation === "storage blob lease release") return ""
    }
    if (executable === "terraform") {
      const [, operation, ...rest] = args
      if (operation === "init") return ""
      if (operation === "state" && rest[0] === "pull")
        return JSON.stringify({ ...JSON.parse(savedState), lineage: openedLineage })
      if (operation === "show" && rest.length === 1)
        return JSON.stringify({ format_version: "1.0", values: { root_module: { resources } } })
      if (operation === "plan") {
        const file = rest.find((arg) => arg.startsWith("-var-file="))!.slice("-var-file=".length)
        planVariables.push(JSON.parse(readFileSync(file, "utf8")))
        return ""
      }
      if (operation === "show") return JSON.stringify(plan ?? imageOnly)
      if (operation === "apply") {
        if (applyFails) throw new Error("terraform apply failed")
        return ""
      }
    }
    throw new Error(`Unexpected command ${executable} ${args.join(" ")}`)
  }
  const keep = () => keepPrivatePreview({
    run,
    variablesPath,
    image: newImage,
    keyVaultId,
    state: { resourceGroup: "sample-hub-state", account: "replicastatesample", container: "terraform" },
    dataDirectory: join(directory, "terraform"),
    log: (message) => logs.push(message),
  })
  const ran = (...prefix: string[]) =>
    commands.filter((command) => prefix.every((part, index) =>
      command[0] === "terraform" ? command[index + (index ? 1 : 0)] === part : command[index] === part))
  const tfvars = () => readFileSync(variablesPath, "utf8")
  return { keep, commands, ran, planVariables, logs, tfvars }
}

describe("keepPrivatePreview", () => {
  it("runs no Terraform when the service was never set up", async () => {
    const s = scenario({ hub: {}, hubSecret: null, stateExists: false })
    const before = s.tfvars()

    await s.keep()

    assert.deepEqual(s.ran("terraform"), [])
    assert.equal(s.tfvars(), before)
  })

  it("blocks when Hub has private preview settings but the saved state is missing", async () => {
    const s = scenario({ hub: { HUB_PRIVATE_PREVIEW_ENABLED: "false" }, stateExists: false })

    await assert.rejects(s.keep(), /private-preview\.tfstate is missing/)
    assert.deepEqual(s.ran("terraform"), [])
  })

  it("blocks private preview settings supplied through GitHub variables", async () => {
    const s = scenario({ supplied: { HUB_PRIVATE_PREVIEW_ENABLED: "false" } })

    await assert.rejects(s.keep(), /remove HUB_PRIVATE_PREVIEW_ENABLED from the GitHub Environment/)
    assert.deepEqual(s.commands, [])
  })

  it("keeps Hub's playback and publishing settings and moves only the reader image under the release lease", async () => {
    const s = scenario()

    await s.keep()

    const saved = JSON.parse(s.tfvars())
    assert.deepEqual(saved.runtime_environment_variables, {
      HUB_TRUSTED_PROXY_HOPS: "1",
      PUBLIC_SETTING: "kept",
      ...playingHub,
    })
    assert.deepEqual(saved.runtime_secret_references, {
      HUB_PRIVATE_PREVIEW_READER_SECRET: { key_vault_id: keyVaultId, secret_id: secretUrl },
    })
    assert.equal(s.planVariables.length, 1)
    const variables = s.planVariables[0]!
    assert.equal(variables.image, newImage)
    assert.equal(variables.reader, "enabled")
    assert.equal(variables.inline_enabled, true)
    assert.equal(variables.hub_application_origin, hubOrigin)
    assert.equal(variables.trusted_proxy_hops, 1)
    assert.equal(variables.custom_hostname, "preview.replica.coreai.design")
    assert.equal(variables.bind_custom_hostname, true)
    assert.deepEqual(variables.reader_secret, { key_vault_id: keyVaultId, secret_id: secretUrl })
    assert.equal(variables.writer_principal_id, writerPrincipal)
    const order = s.commands.map((command) => command.slice(0, 6).join(" "))
    const acquire = order.findIndex((command) => command.includes("lease acquire"))
    const apply = order.findIndex((command) => / apply /.test(` ${command} `))
    const release = order.findIndex((command) => command.includes("lease release"))
    assert.ok(acquire >= 0 && acquire < apply && apply < release)
  })
})

describe("keepPrivatePreview blocks a release that disagrees with the reader", () => {
  for (const [label, env] of [
    ["inline setting", readerEnvironment({ HUB_PRIVATE_PREVIEW_INLINE_ENABLED: "false" })],
    ["reader origin", readerEnvironment({ HUB_PRIVATE_PREVIEW_ORIGIN: "https://sample-hub-preview.example.azurecontainerapps.io" })],
  ] as const)
    it(`blocks before planning when the ${label} differs and leaves the inputs untouched`, async () => {
      const s = scenario({ reader: readerApp(oldImage, { env }) })
      const before = s.tfvars()

      await assert.rejects(s.keep(), new RegExp(`disagree on the ${label}`))
      assert.equal(s.tfvars(), before)
      assert.deepEqual(s.ran("terraform", "plan"), [])
      assert.deepEqual(s.ran("terraform", "apply"), [])
    })
})

describe("keepPrivatePreview keeps playback as it is", () => {
  it("keeps playback off with the reader secret reference when Hub turned it off", async () => {
    const s = scenario({ hub: { HUB_PRIVATE_PREVIEW_ENABLED: "false" }, reader: readerApp(oldImage, { ingress: false, env: [] }) })

    await s.keep()

    const saved = JSON.parse(s.tfvars())
    assert.equal(saved.runtime_environment_variables.HUB_PRIVATE_PREVIEW_ENABLED, "false")
    assert.equal(saved.runtime_environment_variables.HUB_PRIVATE_PREVIEW_ORIGIN, undefined)
    assert.deepEqual(saved.runtime_secret_references.HUB_PRIVATE_PREVIEW_READER_SECRET, { key_vault_id: keyVaultId, secret_id: secretUrl })
    assert.equal(s.planVariables[0]!.reader, "disabled")
  })
})

describe("keepPrivatePreview accepts only an image change", () => {
  const before = readerApp(oldImage)
  for (const [label, change] of [
    ["changes a grant", { address: "azurerm_role_assignment.reader_artifacts[0]", change: { actions: ["delete", "create"], before: {}, after: {} } }],
    ["changes the reader ingress", update("azurerm_container_app.reader[0]", before, { ...readerApp(newImage), ingress: [] })],
    ["changes another resource", update("azurerm_container_app_custom_domain.reader[0]", { name: "a" }, { name: "b" })],
  ] as const)
    it(`blocks a plan that ${label} without taking the lease or applying`, async () => {
      const s = scenario({ plan: { resource_changes: [change] } })

      await assert.rejects(s.keep(), /beyond moving the reader to the new image/)
      assert.deepEqual(s.ran("terraform", "apply"), [])
      assert.deepEqual(s.ran("az", "storage", "blob", "lease"), [])
    })

  it("takes no lease and applies nothing when the reader already runs the image", async () => {
    const s = scenario({ plan: { resource_changes: [{ address: "azurerm_container_app.reader[0]", change: { actions: ["no-op"] } }] } })

    await s.keep()

    assert.deepEqual(s.ran("terraform", "apply"), [])
    assert.deepEqual(s.ran("az", "storage", "blob", "lease"), [])
  })

  it("keeps the release lease when the apply fails", async () => {
    const s = scenario({ applyFails: true })

    await assert.rejects(s.keep(), /terraform apply failed/)
    assert.equal(s.ran("az", "storage", "blob", "lease", "acquire").length, 1)
    assert.deepEqual(s.ran("az", "storage", "blob", "lease", "release"), [])
    assert.ok(s.logs.some((message) => /lease is retained/.test(message)))
  })
})

describe("keepPrivatePreview checks saved state", () => {
  it("blocks state from the earlier preparation step", async () => {
    const s = scenario({ precount: true })

    await assert.rejects(s.keep(), /earlier preparation step/)
    assert.deepEqual(s.ran("terraform", "plan"), [])
  })

  it("blocks when Terraform opens a different state than the saved one", async () => {
    const s = scenario({ openedLineage: randomUUID() })

    await assert.rejects(s.keep(), /different state/)
    assert.deepEqual(s.ran("terraform", "show"), [])
    assert.deepEqual(s.ran("terraform", "plan"), [])
  })
})
