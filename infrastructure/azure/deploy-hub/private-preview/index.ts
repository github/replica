import childProcess from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import { describeCommand } from "../../../installer/command/describe/index.ts"
import { ownedHubSettings } from "../../install/private-preview/hub-environment/index.ts"
import { guardPreviewState } from "../../install/private-preview/state-guard/index.ts"

export type Run = (executable: string, args: string[]) => Promise<string>

type Env = { name?: unknown; value?: unknown }
type StateResource = { address?: unknown; values?: Record<string, unknown> }
type Change = { address?: unknown; change?: { actions?: unknown; before?: unknown; after?: unknown } }
type Variables = {
  subscription_id: string
  name: string
  owner: string
  location: string
  resource_group_name: string
  acr_id: string
  hub_application_origin?: string
  runtime_environment_variables?: Record<string, string>
  runtime_secret_references?: Record<string, { key_vault_id: string; secret_id: string }>
}

const readerSecretKey = "HUB_PRIVATE_PREVIEW_READER_SECRET"
const owned: readonly string[] = [...ownedHubSettings, readerSecretKey]
const previewRoot = resolve(import.meta.dirname, "../../private-preview")
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

const block = (reason: string): never => {
  throw new Error(
    `Private prototype service check failed: ${reason} Hub was not released. Use setup Update to change the private prototype service.`,
  )
}

/*
 * Keeps the private prototype service exactly as setup Update left it. Copies Hub's current
 * private preview settings into the release inputs, checks them against the reader's saved
 * state, and moves the reader to the new image with a plan that may change nothing else.
 */
export async function keepPrivatePreview({
  run,
  variablesPath,
  image,
  keyVaultId,
  state,
  dataDirectory,
  log = console.log,
}: {
  run: Run
  variablesPath: string
  image: string
  keyVaultId: string
  state: { resourceGroup: string; account: string; container: string }
  dataDirectory: string
  log?(message: string): void
}): Promise<void> {
  const variables = JSON.parse(await readFile(variablesPath, "utf8")) as Variables
  const environment = { ...variables.runtime_environment_variables }
  const references = { ...variables.runtime_secret_references }
  const supplied = owned.filter((key) => key in environment || key in references)
  if (supplied.length)
    block(`remove ${supplied.join(", ")} from the GitHub Environment; the release copies them from Hub.`)
  const azure = (...args: string[]) =>
    run("az", [...args, "--subscription", variables.subscription_id, "--only-show-errors", "--output", "json"])
  const read = async <T>(...args: string[]) => JSON.parse(await azure(...args)) as T

  const apps = await read<{ env?: Env[] | null }[]>(
    "containerapp", "list", "--resource-group", variables.resource_group_name,
    "--query", `[?name=='${variables.name}-hub'].{env:properties.template.containers[?name=='hub'] | [0].env}`,
  )
  if (!Array.isArray(apps) || apps.length > 1) block("Hub's current settings could not be read.")
  const live = new Map<string, string>()
  for (const { name, value } of apps[0]?.env ?? [])
    if (typeof name === "string" && typeof value === "string") live.set(name, value)
  let secretUrl: string | undefined
  try {
    const value: unknown = JSON.parse(live.get("AZURE_KEY_VAULT_SECRET_REFERENCES") ?? "{}")
    const url = (value as Record<string, unknown>)[readerSecretKey]
    if (url !== undefined && typeof url !== "string") throw new Error()
    secretUrl = url
  } catch {
    block("Hub's Key Vault references could not be read.")
  }
  const hubSettings = Object.fromEntries(ownedHubSettings.flatMap((key) => (live.has(key) ? [[key, live.get(key)!]] : [])))

  const key = `${variables.name}/private-preview.tfstate`
  const { exists } = await read<{ exists?: unknown }>(
    "storage", "blob", "exists", "--account-name", state.account, "--container-name", state.container,
    "--name", key, "--auth-mode", "login",
  )
  if (typeof exists !== "boolean") block("Azure did not confirm whether saved private preview state exists.")
  if (!exists) {
    if (Object.keys(hubSettings).length || secretUrl) block(`Hub has private preview settings but ${key} is missing.`)
    log("The private prototype service is not set up; nothing to keep.")
    return
  }

  await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
  const terraform = (...args: string[]) => run("terraform", [`-chdir=${previewRoot}`, ...args])
  const guard = await guardPreviewState({
    azure,
    directory: dataDirectory,
    target: { account: state.account, container: state.container, key },
    resourcesExist: async () => true,
  })
  const backend = join(dataDirectory, "private-preview-backend.hcl")
  await writeFile(backend, [
    `resource_group_name = ${JSON.stringify(state.resourceGroup)}`,
    `storage_account_name = ${JSON.stringify(state.account)}`,
    `container_name = ${JSON.stringify(state.container)}`,
    `key = ${JSON.stringify(key)}`,
    "use_azuread_auth = true",
    "use_oidc = true",
    "",
  ].join("\n"), { mode: 0o600 })
  await terraform("init", "-input=false", "-lock-timeout=60s", `-backend-config=${backend}`)
  guard.verify(JSON.parse(await terraform("state", "pull")))
  const snapshot = JSON.parse(await terraform("show", "-json")) as {
    values?: { root_module?: { resources?: StateResource[] } }
  }
  const resources = snapshot.values?.root_module?.resources ?? []
  if (resources.some(({ address }) => typeof address === "string" && !address.endsWith("]") && !(
    ["azurerm_resource_group.reader", "azurerm_container_app_environment.reader", "azurerm_user_assigned_identity.reader", "azurerm_storage_container.reader"].includes(address)
  )))
    block("saved state is from the earlier preparation step. Run setup Update once to upgrade it.")
  const find = (address: string) => resources.find((resource) => resource.address === address)?.values
  const app = find("azurerm_container_app.reader[0]")
  const container = (app?.template as { container?: { env?: Env[] }[] }[] | undefined)?.[0]?.container?.[0]
  const readerEnv = new Map(
    (container?.env ?? []).flatMap(({ name, value }) => (typeof name === "string" && typeof value === "string" ? [[name, value]] : [])),
  )
  const enabled = Boolean((app?.ingress as unknown[] | undefined)?.length)
  const stateSecret = (app?.secret as { key_vault_secret_id?: string }[] | undefined)?.[0]?.key_vault_secret_id
  const domain = find("azurerm_container_app_custom_domain.reader[0]")?.name
  const writerPrincipal = find("azurerm_role_assignment.writer[0]")?.principal_id
  const hubOrigin = variables.hub_application_origin ?? environment.HUB_APPLICATION_ORIGIN
  const hops = environment.HUB_TRUSTED_PROXY_HOPS

  if (hubSettings.HUB_PRIVATE_PREVIEW_ENABLED === "true") {
    if (!enabled) block("Hub plays private Builds, but the reader is not on.")
    const mismatched = [
      ["the reader origin", hubSettings.HUB_PRIVATE_PREVIEW_ORIGIN, readerEnv.get("HUB_PRIVATE_PREVIEW_ORIGIN")],
      ["the inline setting", hubSettings.HUB_PRIVATE_PREVIEW_INLINE_ENABLED ?? "false", readerEnv.get("HUB_PRIVATE_PREVIEW_INLINE_ENABLED")],
      ["the reader secret", secretUrl, stateSecret],
      ["Hub's origin", hubOrigin, readerEnv.get("HUB_APPLICATION_ORIGIN")],
      ["the proxy hop count", hops, readerEnv.get("PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS")],
    ].filter(([, left, right]) => left !== right).map(([label]) => label)
    if (mismatched.length) block(`Hub and the reader disagree on ${mismatched.join(", ")}.`)
  }
  if (hubSettings.HUB_PRIVATE_PREVIEW_WRITE_ENABLED === "true" && typeof writerPrincipal !== "string")
    block("Hub publishes private Builds, but the writer grant is not in saved state.")

  if (secretUrl) {
    const vault = keyVaultId.split("/").at(-1)?.toLowerCase()
    if (new URL(secretUrl).hostname.toLowerCase() !== `${vault}.vault.azure.net`)
      block("Hub's reader secret is not in the installation Key Vault.")
    references[readerSecretKey] = { key_vault_id: keyVaultId, secret_id: secretUrl }
  }
  await writeFile(variablesPath, JSON.stringify({
    ...variables,
    runtime_environment_variables: { ...environment, ...hubSettings },
    runtime_secret_references: references,
  }), { mode: 0o600 })

  if (!app) {
    log("The reader app is removed; Hub's private preview settings were kept.")
    return
  }
  const previewVariables = join(dataDirectory, "private-preview.tfvars.json")
  await writeFile(previewVariables, JSON.stringify({
    subscription_id: variables.subscription_id,
    resource_group_name: variables.resource_group_name,
    location: variables.location,
    name: variables.name,
    owner: variables.owner,
    acr_id: variables.acr_id,
    registry_server: image.split("/")[0],
    storage_account_id: `/subscriptions/${variables.subscription_id}/resourceGroups/${variables.resource_group_name}/providers/Microsoft.Storage/storageAccounts/${variables.name.replaceAll("-", "")}hub`,
    image,
    reader: enabled ? "enabled" : "disabled",
    inline_enabled: readerEnv.get("HUB_PRIVATE_PREVIEW_INLINE_ENABLED") === "true",
    hub_application_origin: enabled ? (readerEnv.get("HUB_APPLICATION_ORIGIN") ?? null) : null,
    trusted_proxy_hops: enabled ? Number(readerEnv.get("PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS")) : null,
    custom_hostname: typeof domain === "string" ? domain : null,
    bind_custom_hostname: typeof domain === "string",
    reader_secret: enabled && stateSecret ? { key_vault_id: keyVaultId, secret_id: stateSecret } : null,
    writer_principal_id: typeof writerPrincipal === "string" ? writerPrincipal : null,
  }), { mode: 0o600 })
  const planPath = join(dataDirectory, `private-preview-${randomUUID()}.tfplan`)
  try {
    await terraform("plan", "-input=false", "-lock-timeout=60s", `-var-file=${previewVariables}`, `-out=${planPath}`)
    const plan = JSON.parse(await terraform("show", "-json", planPath)) as { resource_changes?: Change[] }
    const changes = onlyImageChange(plan, image)
    if (!changes) {
      log("The reader already runs this image.")
      return
    }
    const releaseLock = [
      "--account-name", `${variables.name.replaceAll("-", "")}hub`, "--container-name", "releases",
      "--blob-name", "deployment.lock", "--auth-mode", "login",
    ]
    const lease = randomUUID()
    await azure("storage", "blob", "lease", "acquire", ...releaseLock, "--lease-duration", "-1", "--proposed-lease-id", lease)
    try {
      guard.verify(JSON.parse(await terraform("state", "pull")))
      await terraform("apply", "-input=false", "-lock-timeout=60s", planPath)
      guard.verify(JSON.parse(await terraform("state", "pull")))
    } catch (error) {
      log("The release lease is retained. Verify the reader and saved state before an operator breaks it.")
      throw error
    }
    await azure("storage", "blob", "lease", "release", ...releaseLock, "--lease-id", lease)
    log("The reader now runs the release image.")
  } finally {
    await rm(planPath, { force: true })
  }
}

// Returns whether the plan moves the reader to the image, and rejects any other change.
export function onlyImageChange(plan: { resource_changes?: Change[] }, image: string): boolean {
  let changed = false
  for (const { address, change } of plan.resource_changes ?? []) {
    const actions = Array.isArray(change?.actions) ? change.actions.join("/") : ""
    if (actions === "no-op" || actions === "read") continue
    const before = change?.before as { template?: { container?: { image?: unknown }[] }[] } | undefined
    const after = change?.after as typeof before
    const withImage = before && structuredClone(before)
    const container = withImage?.template?.[0]?.container?.[0]
    if (container) container.image = image
    const keys = ["template", "ingress", "secret", "registry", "identity", "workload_profile_name"] as const
    if (
      address !== "azurerm_container_app.reader[0]" ||
      actions !== "update" ||
      after?.template?.[0]?.container?.[0]?.image !== image ||
      keys.some((name) => !sameJson((withImage as Record<string, unknown>)[name], (after as Record<string, unknown>)[name]))
    )
      block(`the release would ${actions} ${String(address)} beyond moving the reader to the new image.`)
    changed = true
  }
  return changed
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      variables: { type: "string" },
      image: { type: "string" },
      "key-vault-id": { type: "string" },
      "state-resource-group": { type: "string" },
      "state-account": { type: "string" },
      "state-container": { type: "string" },
    },
  })
  const run: Run = async (executable, args) => {
    try {
      return childProcess.execFileSync(executable, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      })
    } catch {
      // Tool output can contain credentials and lease identifiers.
      throw new Error(`${describeCommand(executable, args).label} failed. Tool output remains private.`)
    }
  }
  try {
    const required = (name: keyof typeof values) => values[name] ?? block(`--${name} is required.`)
    const image = required("image")
    if (!/^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$/.test(image)) block("--image must name an immutable digest.")
    await keepPrivatePreview({
      run,
      variablesPath: resolve(required("variables")),
      image,
      keyVaultId: required("key-vault-id"),
      state: {
        resourceGroup: required("state-resource-group"),
        account: required("state-account"),
        container: required("state-container"),
      },
      dataDirectory: resolve(process.env.TF_DATA_DIR ?? ".terraform"),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown failure")
    process.exitCode = 1
  }
}
