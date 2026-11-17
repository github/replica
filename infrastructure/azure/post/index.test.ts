import { createHash, generateKeyPairSync, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../installer/command/index.ts"
import { withDefaultSignal } from "../../installer/command/default-signal/index.ts"
import { retryReadOnly } from "../../installer/command/retry-read-only/index.ts"
import type { DeploymentConfig, RunCommand, WizardUI } from "../../installer/types.ts"
import { installationWorkspace } from "../../installer/workspace/index.ts"
import * as installationInputs from "../install/inputs/index.ts"
import { installationNames } from "../install/settings.ts"
import type { PostInputs, PostSetupTarget } from "./types.ts"
import { postSetupAzure } from "./index.ts"

vi.mock("ink", async (importOriginal) => {
  const ink = await importOriginal<typeof import("ink")>()
  return {
    ...ink,
    render(): ReturnType<typeof ink.render> {
      return {
        rerender() {},
        unmount() {},
        waitUntilExit: async () => undefined,
        waitUntilRenderFlush: async () => undefined,
        cleanup() {},
        clear() {},
      }
    },
  }
})

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario() {
  const root = resolve(`.post-setup-test-${randomUUID()}`)
  directories.push(root)
  await mkdir(root, { mode: 0o700 })
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "sample-hub",
    owner: "sample-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "sample-hub-rg",
    },
  }
  const target: PostSetupTarget = { path: join(root, "installation.json"), config }
  const directory = installationWorkspace(config, root)
  await mkdir(directory, { mode: 0o700 })
  await writeFile(target.path, JSON.stringify(config), { mode: 0o600 })
  const names = installationNames(config)
  const group = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}`
  const appId = `${group}/providers/Microsoft.App/containerApps/sample-hub-hub`
  const environmentId = `${group}/providers/Microsoft.App/managedEnvironments/sample-hub-environment`
  const identityId = `${group}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/sample-hub-hub`
  const principalId = "00000000-0000-0000-0000-000000000003"
  const image = `registry.azurecr.io/hub@sha256:${"a".repeat(64)}`
  const origin = "https://sample-hub.eastus2.azurecontainerapps.io"
  const vaultId = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}`
  const reference = (name: string, version = "a".repeat(32)) => ({
    key_vault_id: vaultId,
    secret_id: `https://${names.vault}.vault.azure.net/secrets/${name}/${version}`,
  })
  const inputs: PostInputs = {
    subscription_id: config.azure.subscriptionId,
    name: config.name,
    owner: config.owner,
    location: config.azure.location,
    resource_group_name: config.azure.resourceGroup,
    grant_deployment_storage_access: true,
    image: `registry.azurecr.io/hub@sha256:${"b".repeat(64)}`,
    deploy_hub: false,
    hub_application_origin: origin,
    acr_id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.ContainerRegistry/registries/${names.registry}`,
    runtime_database_secret: reference("database-runtime"),
    setup_database_secret: reference("database-setup"),
    runtime_environment_variables: {
      PUBLIC_SETTING: "retained",
      EMPTY_SETTING: "",
      HUB_TRUSTED_PROXY_HOPS: "1",
    },
    runtime_secret_references: {
      SERVICE_API_KEY: reference("service-api-key"),
      HUB_AUTHENTICATION_ENCRYPTION_KEY: reference("hub-authentication-encryption-key"),
      HUB_BOOTSTRAP_SECRET: reference("hub-bootstrap-secret"),
    },
    postgres_sku: "GP_Standard_D2s_v3",
    postgres_version: "17",
    backup_retention_days: 14,
  }
  const inputsPath = join(directory, "installation.tfvars.json")
  const original = JSON.stringify(inputs)
  await writeFile(inputsPath, original, { mode: 0o600 })
  const secretValues = new Map([
    ["hub-authentication-encryption-key", Buffer.alloc(32, 7).toString("base64")],
    ["hub-bootstrap-secret", "synthetic-bootstrap-secret-for-tests-only"],
  ])
  const environmentFor = (value: PostInputs): Record<string, string> => ({
    NODE_ENV: "production",
    ...value.runtime_environment_variables,
    ...(value.hub_application_origin && { HUB_APPLICATION_ORIGIN: value.hub_application_origin }),
    ...(value.github_app_id && { GITHUB_APP_ID: value.github_app_id }),
    ...(value.github_client_id && { GITHUB_CLIENT_ID: value.github_client_id }),
    ...(value.github_app_installation_id && {
      GITHUB_APP_INSTALLATION_ID: value.github_app_installation_id,
    }),
    ...(value.github_provider_revision !== undefined && {
      GITHUB_PROVIDER_REVISION: String(value.github_provider_revision),
    }),
    AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
      DATABASE_URL: reference("database-runtime").secret_id,
      ...Object.fromEntries(
        Object.entries(value.runtime_secret_references ?? {}).map(([key, value]) => [
          key,
          value.secret_id,
        ]),
      ),
    }),
  })
  const state = {
    revision: "sample-hub-hub--current",
    active: true,
    environment: environmentFor(inputs),
    customHosts: [] as string[],
    verificationOrigin: origin,
    failApply: false,
    foreignRetryPlan: false,
    locked: false,
    activeJob: false,
    verifyFailures: 0,
    github: false,
    recovery: "exit",
    afterAccount: undefined as (() => void) | undefined,
  }
  const plans: { path: string; desired: PostInputs; changed: boolean }[] = []
  const leases = new Map<string, string>()
  const uploads: { name: string; id: string }[] = []
  let applies = 0
  let setupReads = 0
  const tags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  const appValues = (environment: Record<string, string>) => ({
    id: appId,
    name: "sample-hub-hub",
    template: [
      {
        min_replicas: 1,
        max_replicas: 1,
        container: [
          {
            name: "hub",
            image,
            cpu: 0.5,
            memory: "1Gi",
            env: Object.entries(environment).map(([name, value]) => ({ name, value })),
          },
        ],
      },
    ],
  })
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]!
  const run = vi.fn<RunCommand>(async (executable, args, options) => {
    if (executable === "terraform") {
      expect(args[0]).toBe(`-chdir=${resolve(import.meta.dirname, "..")}`)
      expect(options?.env?.TF_DATA_DIR).toBe(join(directory, "terraform", "post"))
      if (args[1] === "init") {
        const backend = await readFile(
          args.find((value) => value.startsWith("-backend-config="))!.slice(16),
          "utf8",
        )
        expect(backend).toContain(`resource_group_name = "${names.stateGroup}"`)
        expect(backend).toContain(`storage_account_name = "${names.stateAccount}"`)
        expect(backend).toContain(`key = "${config.name}/app.tfstate"`)
        return ""
      }
      if (args[1] === "output")
        return JSON.stringify({
          app_id: appId,
          resource_group: config.azure.resourceGroup,
          storage_account: "samplehubhub",
        })
      if (args[1] === "show" && !args[3])
        return JSON.stringify({
          values: {
            root_module: {
              resources: [
                { address: "azurerm_container_app.hub[0]", values: appValues(state.environment) },
                {
                  address: "azurerm_user_assigned_identity.hub",
                  values: { principal_id: principalId },
                },
                {
                  address: "azurerm_postgresql_flexible_server.database",
                  values: { administrator_password: "synthetic-existing-database-password" },
                },
              ],
            },
          },
        })
      if (args[1] === "plan") {
        const desired = JSON.parse(await readFile(inputsPath, "utf8")) as PostInputs
        expect(desired.image).toBe(image)
        expect(desired.deploy_hub).toBe(true)
        expect(options?.env?.TF_VAR_postgres_admin_password).toBe(
          "synthetic-existing-database-password",
        )
        plans.push({
          path: args.find((value) => value.startsWith("-out="))!.slice(5),
          desired,
          changed: JSON.stringify(state.environment) !== JSON.stringify(environmentFor(desired)),
        })
        return ""
      }
      if (args[1] === "show")
        return JSON.stringify({
          resource_changes: [
            {
              address:
                state.foreignRetryPlan && plans.length > 1
                  ? "azurerm_storage_account.artifacts"
                  : "azurerm_container_app.hub[0]",
              mode: "managed",
              type: "azurerm_container_app",
              change: {
                actions: [plans.at(-1)!.changed ? "update" : "no-op"],
                before: appValues(state.environment),
                after: appValues(environmentFor(plans.at(-1)!.desired)),
              },
            },
          ],
        })
      if (args[1] === "apply") {
        applies++
        expect(args.at(-1)).toBe(plans.at(-1)!.path)
        if (state.failApply) throw new CommandExecutionError("Synthetic apply failure", false, 1)
        if (plans.at(-1)!.changed) {
          state.revision = "sample-hub-hub--post"
          state.active = true
          state.environment = environmentFor(plans.at(-1)!.desired)
        }
        return ""
      }
      throw new Error(`Unexpected Terraform operation: ${args[1]}`)
    }
    if (executable !== "az")
      throw new Error(
        "Post-setup must not build, publish, provision a database, or run the full release",
      )
    expect(flag(args, "--subscription")).toBe(config.azure.subscriptionId)
    if (args.includes("--resource-group"))
      expect([config.azure.resourceGroup, names.foundationGroup]).toContain(
        flag(args, "--resource-group"),
      )
    const operation = args.slice(0, 3).join(" ")
    if (operation.startsWith("account show")) {
      state.afterAccount?.()
      return JSON.stringify({ id: config.azure.subscriptionId, tenantId: config.azure.tenantId })
    }
    if (operation.startsWith("group exists")) return "true"
    if (operation.startsWith("group show")) return JSON.stringify({ tags })
    if (operation.startsWith("containerapp show")) {
      const query = flag(args, "--query")
      if (query === "properties.latestRevisionName") return JSON.stringify(state.revision)
      if (query.includes("latest:"))
        return JSON.stringify({
          id: appId,
          latest: state.revision,
          ready: state.revision,
          traffic: [{ weight: 100, latestRevision: true }],
        })
      return JSON.stringify({
        id: appId,
        name: "sample-hub-hub",
        environmentId,
        fqdn: new URL(origin).hostname,
        revisionMode: "Multiple",
        traffic: [{ weight: 100, latestRevision: true }],
        customDomains: state.customHosts,
      })
    }
    if (operation === "containerapp revision list") {
      if (args.includes("--all") && !args.includes("--query"))
        return JSON.stringify([
          { name: state.revision, properties: { active: state.active } },
          { name: "sample-hub-hub--old", properties: { active: false } },
        ])
      return JSON.stringify([
        {
          name: state.revision,
          active: state.active,
          image,
          env: Object.entries(state.environment).map(([name, value]) => ({ name, value })),
        },
      ])
    }
    if (operation === "containerapp revision show")
      return JSON.stringify({
        name: state.revision,
        active: state.active,
        health: "Healthy",
        image,
      })
    if (operation === "containerapp revision restart") return ""
    if (operation === "containerapp revision deactivate") {
      expect(flag(args, "--revision")).toBe(state.revision)
      state.active = false
      return ""
    }
    if (operation === "containerapp replica list") return "[]"
    if (operation.startsWith("identity show"))
      return JSON.stringify({ id: identityId, principalId })
    if (operation === "containerapp job list") return JSON.stringify(["sample-hub-setup"])
    if (operation === "containerapp job execution")
      return JSON.stringify([state.activeJob ? "Running" : "Succeeded"])
    if (operation.startsWith("keyvault show"))
      return JSON.stringify({ id: vaultId, rbac: true, softDelete: true, purgeProtection: true })
    if (operation === "keyvault secret list") return JSON.stringify([...secretValues.keys()])
    if (operation === "keyvault secret show") {
      const id = flag(args, "--id")
      const value = secretValues.get(new URL(id).pathname.split("/")[2]!)
      if (value === undefined) throw new Error("Only existing shared secrets may be read")
      if (flag(args, "--query") === "value") return JSON.stringify(value)
      return JSON.stringify({ value, id, enabled: true })
    }
    if (operation === "keyvault secret set") {
      expect(args).not.toContain("--value")
      const path = flag(args, "--file")
      const name = flag(args, "--name")
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      secretValues.set(name, await readFile(path, "utf8"))
      const id = reference(name, "b".repeat(32)).secret_id
      uploads.push({ name, id })
      return JSON.stringify(id)
    }
    if (operation === "storage blob show") {
      const key = `${flag(args, "--account-name")}/${flag(args, "--container-name")}/${flag(args, "--name")}`
      return JSON.stringify(
        leases.has(key)
          ? { status: "locked", state: "leased", duration: "infinite" }
          : { status: "unlocked", state: "available", duration: null },
      )
    }
    if (operation === "storage blob lease") {
      const key = `${flag(args, "--account-name")}/${flag(args, "--container-name")}/${flag(args, "--blob-name")}`
      if (args[3] === "acquire") {
        if (state.locked) throw new CommandExecutionError("Synthetic lease conflict", false, 1)
        const lease = flag(args, "--proposed-lease-id")
        leases.set(key, lease)
        return JSON.stringify(lease)
      }
      expect(flag(args, "--lease-id")).toBe(leases.get(key))
      if (args[3] === "release") leases.delete(key)
      else expect(args[3]).toBe("renew")
      return ""
    }
    throw new Error(`Unexpected Azure command: ${args.slice(0, 4).join(" ")}`)
  })
  const ui: WizardUI = {
    cloud: vi.fn(),
    text: vi.fn(async (_label, initial) => (initial === origin ? origin : "2")),
    select: vi.fn(async () => state.recovery),
    confirm: vi.fn(async () => true),
    status: vi.fn(),
    notice: vi.fn(),
    wait: vi.fn(),
    complete: vi.fn(),
  }
  const provider = { revision: 0, enabled: true, verifications: 0 }
  const operatorUI = new Proxy(ui, {
    get(target, key, receiver) {
      if (key === "text")
        return async (label: string, initial?: string) => {
          if (/^Last stored GitHub provider revision/i.test(label)) {
            provider.verifications++
            return String(provider.revision)
          }
          return target.text(label, initial)
        }
      if (key === "confirm")
        return async (message: string) => {
          if (/last stored GitHub provider revision/i.test(message)) return true
          if (/provider/i.test(message) && /enabled/i.test(message)) return provider.enabled
          return target.confirm(message)
        }
      return Reflect.get(target, key, receiver)
    },
  })
  const request = vi.fn<typeof fetch>(async (input) => {
    if (String(input) === `${state.verificationOrigin}/api/ready`)
      return new Response(null, { status: 200 })
    if (String(input) === `${state.verificationOrigin}/api/settings/github/status`) {
      setupReads++
      return setupReads <= state.verifyFailures
        ? new Response(null, { status: 404 })
        : Response.json({ requires: "bootstrap" }, { status: 403 })
    }
    if (state.github && String(input) === `${state.verificationOrigin}/api/auth/providers`)
      return Response.json({ providers: ["github"] })
    throw new Error("Shared-only mode must not require authentication providers")
  })
  return {
    target,
    directory,
    inputsPath,
    original,
    inputs,
    image,
    origin,
    state,
    run,
    ui,
    operatorUI,
    provider,
    request,
    plans,
    leases,
    secretValues,
    uploads,
    reference,
    get applies() {
      return applies
    },
  }
}

async function configuredGithub(test: Awaited<ReturnType<typeof scenario>>) {
  test.provider.revision = 4
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
  Object.assign(test.inputs, {
    hub_application_origin: test.origin,
    github_app_id: "123",
    github_client_id: "Iv23synthetic",
    github_app_installation_id: "456",
    github_provider_revision: 4,
  })
  Object.assign(test.inputs.runtime_secret_references!, {
    GITHUB_CLIENT_SECRET: test.reference("github-client-secret"),
    GITHUB_APP_PRIVATE_KEY_BASE64: test.reference("github-app-private-key"),
    GITHUB_WEBHOOK_SECRET: test.reference("github-webhook-secret"),
  })
  test.secretValues.set("github-client-secret", "synthetic-client-secret")
  test.secretValues.set("github-app-private-key", Buffer.from(pem).toString("base64"))
  test.secretValues.set("github-webhook-secret", "synthetic-webhook-secret-for-tests-only")
  Object.assign(test.state.environment, {
    HUB_APPLICATION_ORIGIN: test.origin,
    GITHUB_APP_ID: "123",
    GITHUB_CLIENT_ID: "Iv23synthetic",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_PROVIDER_REVISION: "4",
    AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
      ...JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!),
      GITHUB_CLIENT_SECRET: test.reference("github-client-secret").secret_id,
      GITHUB_APP_PRIVATE_KEY_BASE64: test.reference("github-app-private-key").secret_id,
      GITHUB_WEBHOOK_SECRET: test.reference("github-webhook-secret").secret_id,
    }),
  })
  test.state.github = true
  await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
}

function expectNoDeploymentMutation(test: Awaited<ReturnType<typeof scenario>>) {
  expect(test.plans).toEqual([])
  expect(test.applies).toBe(0)
  expect(test.uploads).toEqual([])
  expect(
    test.run.mock.calls.some(
      ([executable, args]) =>
        executable === "terraform" ||
        (args[0] === "keyvault" && args[1] === "secret" && !["list", "show"].includes(args[2]!)) ||
        (args[0] === "containerapp" &&
          args[1] === "revision" &&
          ["restart", "activate", "deactivate", "delete"].includes(args[2]!)),
    ),
  ).toBe(false)
}

it("announces the operation before awaiting a post-confirmation command without printing its arguments", async () => {
  const test = await scenario()
  const work = Promise.withResolvers<void>()
  let confirmed = false
  let waiting = false
  let operation: string | undefined
  vi.mocked(test.ui.confirm).mockImplementation(async () => {
    confirmed = true
    return true
  })
  const run: RunCommand = async (executable, args, options) => {
    if (confirmed && !waiting) {
      waiting = true
      operation = vi.mocked(test.ui.status).mock.calls.at(-1)?.[0]
      await work.promise
    }
    return test.run(executable, args, options)
  }
  const pending = postSetupAzure(test.target, {
    action: "restart",
    run,
    ui: test.ui,
    request: test.request,
  })
  void pending.catch(() => undefined)
  try {
    await vi.waitFor(() => expect(waiting).toBe(true))
    expect(operation).toMatch(/lease/i)
    expect(operation).not.toContain("--")
    expect(operation).not.toContain(test.target.config.azure.subscriptionId)
  } finally {
    work.resolve()
    await pending
  }
})

it("uses the deployed digest despite stale deploy_hub=false and preserves settings across verification and configuration reruns", async () => {
  const test = await scenario()
  expect(test.state.environment.HUB_TRUSTED_PROXY_HOPS).toBe("1")
  test.state.verifyFailures = 1
  test.state.recovery = "verify"

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    }),
  ).resolves.toContain(test.origin)

  const saved = JSON.parse(await readFile(test.inputsPath, "utf8")) as PostInputs
  expect(saved).toEqual({
    ...test.inputs,
    image: test.image,
    deploy_hub: true,
    hub_application_origin: test.origin,
    runtime_environment_variables: {
      ...test.inputs.runtime_environment_variables,
      HUB_TRUSTED_PROXY_HOPS: "2",
    },
  })
  expect(test.plans[0]!.changed).toBe(true)
  expect(test.applies).toBe(1)
  expect(test.ui.text).toHaveBeenCalledTimes(2)
  expect(test.ui.select).toHaveBeenCalledTimes(1)
  expect(test.leases.size).toBe(0)
  expect(test.ui.complete).toHaveBeenCalledOnce()
  expect(
    test.run.mock.calls.filter(
      ([, args]) => args.slice(0, 3).join(" ") === "containerapp revision deactivate",
    ),
  ).toHaveLength(1)
  const retained = await Promise.all(
    (await readdir(test.directory))
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFile(join(test.directory, name), "utf8")),
  )
  const visible = JSON.stringify([
    retained,
    vi.mocked(test.ui.status).mock.calls,
    vi.mocked(test.ui.notice!).mock.calls,
  ])
  for (const secret of [...test.secretValues.values(), "synthetic-existing-database-password"])
    expect(visible).not.toContain(secret)

  await postSetupAzure(test.target, {
    action: "sign-in",
    run: test.run,
    ui: test.ui,
    request: test.request,
  })

  expect(JSON.parse(await readFile(test.inputsPath, "utf8"))).toEqual(saved)
  expect(test.plans.at(-1)!.changed).toBe(false)
  expect(
    test.run.mock.calls.filter(
      ([, args]) => args.slice(0, 3).join(" ") === "containerapp revision deactivate",
    ),
  ).toHaveLength(1)
  expect(
    test.run.mock.calls.some(([, args]) => args.slice(0, 3).join(" ") === "keyvault secret set"),
  ).toBe(false)
  expect(test.leases.size).toBe(0)
})

it("repairs a stopped Hub with saved authentication secrets but no origin only after a valid answer", async () => {
  const test = await scenario()
  delete test.inputs.hub_application_origin
  delete test.state.environment.HUB_APPLICATION_ORIGIN
  test.state.active = false
  const original = `${JSON.stringify(test.inputs, null, 2)}\n`
  await writeFile(test.inputsPath, original, { mode: 0o600 })
  const environment = structuredClone(test.state.environment)
  const secrets = new Map(test.secretValues)
  const references = structuredClone(test.inputs.runtime_secret_references!)

  await expect(
    installationInputs.readInstallationInputs(test.directory, test.target.config),
  ).rejects.toThrow(/origin/i)
  vi.mocked(test.ui.text).mockResolvedValueOnce(test.origin.replace("https:", "http:"))

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    }),
  ).rejects.toMatchObject({ name: "AbortError", partialChanges: false })

  expect(vi.mocked(test.ui.text).mock.calls[0]![1]).toBe(test.origin)
  expect(await readFile(test.inputsPath, "utf8")).toBe(original)
  expect(test.state.environment).toEqual(environment)
  expect(test.state.active).toBe(false)
  expect(test.secretValues).toEqual(secrets)
  expect(test.leases.size).toBe(0)
  expect(
    (await readdir(test.directory)).filter((name) => name.startsWith("post-inputs-backup-")),
  ).toEqual([])
  expectNoDeploymentMutation(test)

  vi.mocked(test.ui.text).mockReset().mockResolvedValueOnce(test.origin).mockResolvedValueOnce("2")
  const inputReads = vi.spyOn(installationInputs, "readInstallationInputs")
  const execute = test.run.getMockImplementation()!
  let validatedBeforeTerraform = false
  test.run.mockImplementation(async (executable, args, options) => {
    if (executable === "terraform" && !validatedBeforeTerraform) {
      expect(inputReads.mock.calls.length).toBeGreaterThanOrEqual(2)
      const [directory, config, validationOptions] = inputReads.mock.calls.at(-1)!
      expect(directory).toBe(test.directory)
      expect(config).toEqual(test.target.config)
      expect(validationOptions?.allowMissingAuthenticationOrigin ?? false).toBe(false)
      await expect(inputReads.mock.results.at(-1)!.value).resolves.toMatchObject({
        hub_application_origin: test.origin,
        runtime_secret_references: references,
      })
      validatedBeforeTerraform = true
    }
    return execute(executable, args, options)
  })

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    }),
  ).resolves.toContain(`${test.origin}/settings/github/setup`)

  expect(validatedBeforeTerraform).toBe(true)
  const saved = JSON.parse(await readFile(test.inputsPath, "utf8")) as PostInputs
  expect(saved).toEqual({
    ...test.inputs,
    image: test.image,
    deploy_hub: true,
    hub_application_origin: test.origin,
    runtime_environment_variables: {
      ...test.inputs.runtime_environment_variables,
      HUB_TRUSTED_PROXY_HOPS: "2",
    },
  })
  const backups = (await readdir(test.directory)).filter((name) =>
    /^post-inputs-backup-.*\.json$/.test(name),
  )
  expect(backups).toHaveLength(1)
  const backup = join(test.directory, backups[0]!)
  expect(await readFile(backup, "utf8")).toBe(original)
  expect((await stat(backup)).mode & 0o777).toBe(0o600)
  expect(test.state.environment).toEqual({
    ...environment,
    HUB_APPLICATION_ORIGIN: test.origin,
    HUB_TRUSTED_PROXY_HOPS: "2",
  })
  expect(test.state.active).toBe(true)
  expect(test.secretValues).toEqual(secrets)
  expect(test.uploads).toEqual([])
  expect(test.plans).toHaveLength(1)
  expect(test.plans[0]!.changed).toBe(true)
  expect(test.applies).toBe(1)
  expect(test.leases.size).toBe(0)
})

it.each([
  { action: "github", problem: "missing origin", error: /origin/i },
  { action: "restart", problem: "missing origin", error: /origin/i },
  { action: "sign-in", problem: "invalid explicit origin", error: /origin/i },
  { action: "sign-in", problem: "unrelated malformed setting", error: /invalid|unsupported/i },
] as const)(
  "blocks $action for $problem without changing the installation",
  async ({ action, problem, error }) => {
    const test = await scenario()
    delete test.inputs.hub_application_origin
    delete test.state.environment.HUB_APPLICATION_ORIGIN
    if (problem === "invalid explicit origin") {
      test.inputs.hub_application_origin = test.origin.replace("https:", "http:")
      test.state.environment.HUB_APPLICATION_ORIGIN = test.inputs.hub_application_origin
    } else if (problem === "unrelated malformed setting") {
      test.inputs.postgres_version = "99"
    }
    const original = `${JSON.stringify(test.inputs, null, 2)}\n`
    await writeFile(test.inputsPath, original, { mode: 0o600 })
    const environment = structuredClone(test.state.environment)
    const secrets = new Map(test.secretValues)
    const files = (await readdir(test.directory)).sort()

    await expect(
      postSetupAzure(test.target, {
        action,
        run: test.run,
        ui: test.ui,
        request: test.request,
      }),
    ).rejects.toThrow(error)

    expect(await readFile(test.inputsPath, "utf8")).toBe(original)
    expect((await readdir(test.directory)).sort()).toEqual(files)
    expect(test.state.environment).toEqual(environment)
    expect(test.secretValues).toEqual(secrets)
    expect(test.ui.confirm).not.toHaveBeenCalled()
    expect(test.ui.text).not.toHaveBeenCalled()
    expectNoDeploymentMutation(test)
  },
)

it("restarts only the traffic-serving revision without Terraform or rewriting stale saved inputs", async () => {
  const test = await scenario()

  await postSetupAzure(test.target, {
    action: "restart",
    run: test.run,
    ui: test.ui,
    request: test.request,
  })

  expect(test.run.mock.calls.filter(([executable]) => executable === "terraform")).toEqual([])
  const restarts = test.run.mock.calls.filter(
    ([, args]) => args.slice(0, 3).join(" ") === "containerapp revision restart",
  )
  expect(restarts).toHaveLength(1)
  expect(restarts[0]![1]).toEqual(
    expect.arrayContaining([
      "--name",
      "sample-hub-hub",
      "--resource-group",
      test.target.config.azure.resourceGroup,
      "--revision",
      "sample-hub-hub--current",
    ]),
  )
  expect(
    test.run.mock.calls.some(
      ([, args]) => args.includes("activate") || args.includes("deactivate"),
    ),
  ).toBe(false)
  expect(await readFile(test.inputsPath, "utf8")).toBe(test.original)
  expect(test.ui.text).not.toHaveBeenCalled()
  expect(test.leases.size).toBe(0)
})

it.each(["DATABASE_URL", "SERVICE_API_KEY"] as const)(
  "refuses to restart when the live %s Key Vault reference is not version-pinned",
  async (key) => {
    const test = await scenario()
    const reference =
      key === "DATABASE_URL"
        ? (test.inputs.runtime_database_secret as { secret_id: string })
        : test.inputs.runtime_secret_references!.SERVICE_API_KEY!
    reference.secret_id = reference.secret_id.replace(/\/[^/]+$/, "")
    const liveReferences = JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
    liveReferences[key] = reference.secret_id
    test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
    const saved = JSON.stringify(test.inputs)
    await writeFile(test.inputsPath, saved, { mode: 0o600 })
    const environment = structuredClone(test.state.environment)

    await expect(
      postSetupAzure(test.target, {
        action: "restart",
        run: test.run,
        ui: test.ui,
        request: test.request,
      }),
    ).rejects.toThrow(/version|pinned/i)

    expect(await readFile(test.inputsPath, "utf8")).toBe(saved)
    expect(test.state.environment).toEqual(environment)
    expect(test.applies).toBe(0)
    expect(
      test.run.mock.calls.some(([, args]) =>
        ["restart", "activate", "deactivate", "set"].some((value) => args.includes(value)),
      ),
    ).toBe(false)
  },
)

it.each(["sign-in", "github", "restart"] as const)(
  "blocks %s when pending desired-input evidence no longer matches even a formatting-only edit",
  async (action) => {
    const test = await scenario()
    const journalPath = join(test.directory, "post-desired.json")
    const journal = JSON.stringify({
      target: JSON.stringify(test.target.config),
      hash: createHash("sha256").update(test.original).digest("hex"),
      action: "sign-in",
      phase: "pending",
      previousReferences: JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!),
    })
    await writeFile(journalPath, journal, { mode: 0o600 })
    const editedInputs = `${test.original}\n`
    await writeFile(test.inputsPath, editedInputs, { mode: 0o600 })
    const environment = structuredClone(test.state.environment)

    await expect(
      postSetupAzure(test.target, {
        action,
        run: test.run,
        ui: test.ui,
        request: test.request,
      }),
    ).rejects.toThrow(/pending|evidence|recovery|inputs.*changed|inputs.*match/i)

    expect(await readFile(journalPath, "utf8")).toBe(journal)
    expect(await readFile(test.inputsPath, "utf8")).toBe(editedInputs)
    expect(test.state.environment).toEqual(environment)
    expect(test.plans).toEqual([])
    expect(test.applies).toBe(0)
    expect(test.uploads).toEqual([])
    expect(
      test.run.mock.calls.some(([, args]) =>
        ["restart", "activate", "deactivate"].some((value) => args.includes(value)),
      ),
    ).toBe(false)
  },
)

it("blocks an origin change with Entra configured before creating shared secrets or saving inputs", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.origin
  Object.assign(test.inputs.runtime_environment_variables!, {
    ENTRA_OIDC_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
    ENTRA_OIDC_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
    ENTRA_OIDC_PROVIDER_REVISION: "4",
    ENTRA_OIDC_CLIENT_AUTHENTICATION: "managed-identity",
    ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID: "33333333-3333-4333-8333-333333333333",
  })
  delete test.inputs.runtime_secret_references!.HUB_AUTHENTICATION_ENCRYPTION_KEY
  delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
  test.secretValues.clear()
  Object.assign(test.state.environment, test.inputs.runtime_environment_variables, {
    HUB_APPLICATION_ORIGIN: test.origin,
    AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify({
      DATABASE_URL: test.reference("database-runtime").secret_id,
      SERVICE_API_KEY: test.reference("service-api-key").secret_id,
    }),
  })
  test.state.customHosts = ["bound.example.com"]
  const saved = JSON.stringify(test.inputs)
  await writeFile(test.inputsPath, saved, { mode: 0o600 })
  const environment = structuredClone(test.state.environment)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("https://bound.example.com")
    .mockResolvedValueOnce("2")

  const failure: unknown = await postSetupAzure(test.target, {
    action: "sign-in",
    run: test.run,
    ui: test.ui,
    request: test.request,
  }).catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(Error)
  expect(JSON.stringify([String(failure), vi.mocked(test.ui.notice!).mock.calls])).toMatch(/entra/i)
  expect(await readFile(test.inputsPath, "utf8")).toBe(saved)
  expect(test.state.environment).toEqual(environment)
  expect(test.uploads).toEqual([])
  expect(test.plans).toEqual([])
  expect(test.applies).toBe(0)
  expect((await readdir(test.directory)).filter((name) => name.startsWith("post-bootstrap-"))).toEqual(
    [],
  )
})

it.each(["plain", "secret-backed"] as const)(
  "uses a canonical lowercase %s custom origin through sign-in, GitHub setup and verification",
  async (representation) => {
    const test = await scenario()
    const customOrigin = "https://bound.example.com"
    test.state.customHosts = ["Bound.Example.COM"]
    test.state.verificationOrigin = customOrigin
    const originReference = test.reference("hub-application-origin")
    if (representation === "secret-backed") {
      delete test.inputs.hub_application_origin
      delete test.inputs.runtime_environment_variables!.HUB_APPLICATION_ORIGIN
      delete test.state.environment.HUB_APPLICATION_ORIGIN
      test.inputs.runtime_secret_references!.HUB_APPLICATION_ORIGIN = originReference
      test.secretValues.set("hub-application-origin", customOrigin)
      test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify({
        ...JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!),
        HUB_APPLICATION_ORIGIN: originReference.secret_id,
      })
      await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
    }
    vi.mocked(test.ui.text).mockResolvedValueOnce(customOrigin).mockResolvedValueOnce("2")

    const signIn = await postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.operatorUI,
      request: test.request,
    })

    expect(signIn).toContain(`${customOrigin}/settings/github/setup`)
    expect(test.state.environment.HUB_APPLICATION_ORIGIN).toBe(
      representation === "plain" ? customOrigin : undefined,
    )
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString()
    const values = ["synthetic-client-secret", pem, "synthetic-webhook-secret-for-tests-only"]
    const paths = values.map((_, index) => join(test.directory, `custom-origin-credential-${index}`))
    await Promise.all(paths.map((path, index) => writeFile(path, values[index]!, { mode: 0o600 })))
    vi.mocked(test.ui.text)
      .mockReset()
      .mockResolvedValueOnce("123")
      .mockResolvedValueOnce("Iv23synthetic")
      .mockResolvedValueOnce("456")
      .mockResolvedValueOnce(paths[0]!)
      .mockResolvedValueOnce(paths[1]!)
      .mockResolvedValueOnce(paths[2]!)
      .mockResolvedValueOnce("1")
    test.state.github = true

    const github = await postSetupAzure(test.target, {
      action: "github",
      run: test.run,
      ui: test.operatorUI,
      request: test.request,
    })

    expect(github).toContain(`${customOrigin}/settings/github/setup`)
    expect(test.state.environment.HUB_APPLICATION_ORIGIN).toBe(
      representation === "plain" ? customOrigin : undefined,
    )
    if (representation === "secret-backed") {
      const saved = JSON.parse(await readFile(test.inputsPath, "utf8")) as PostInputs
      expect(saved.hub_application_origin).toBeUndefined()
      expect(saved.runtime_secret_references!.HUB_APPLICATION_ORIGIN).toEqual(originReference)
    }
    expect(test.state.environment.GITHUB_PROVIDER_REVISION).toBe("1")
    const requestedURLs = test.request.mock.calls.map(([url]) => String(url))
    expect(requestedURLs).toContain(`${customOrigin}/api/ready`)
    expect(requestedURLs).toContain(`${customOrigin}/api/settings/github/status`)
    expect(requestedURLs).toContain(`${customOrigin}/api/auth/providers`)
    expect(requestedURLs.every((url) => url.startsWith(`${customOrigin}/`))).toBe(true)
  },
)

it("advances a configured GitHub provider from the verified database revision on origin change", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.provider.revision = 7
  test.state.customHosts = ["BOUND.example.com"]
  test.state.verificationOrigin = "https://bound.example.com"
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("https://bound.example.com")
    .mockResolvedValueOnce("2")

  await postSetupAzure(test.target, {
    action: "sign-in",
    run: test.run,
    ui: test.operatorUI,
    request: test.request,
  })

  const saved = JSON.parse(await readFile(test.inputsPath, "utf8")) as PostInputs
  expect(saved.hub_application_origin).toBe("https://bound.example.com")
  expect(saved.github_provider_revision).toBe(8)
  expect(test.state.environment.GITHUB_PROVIDER_REVISION).toBe("8")
  expect(test.provider.verifications).toBe(1)
  expect(test.uploads).toEqual([])
})

it("does not apply an unrelated stale proxy setting during GitHub configuration", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.state.environment.HUB_TRUSTED_PROXY_HOPS = "3"
  const saved = await readFile(test.inputsPath, "utf8")
  const environment = structuredClone(test.state.environment)
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  const failure: unknown = await postSetupAzure(test.target, {
    action: "github",
    run: test.run,
    ui: test.ui,
    request: test.request,
  }).catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(Error)
  expect(JSON.stringify([String(failure), vi.mocked(test.ui.notice!).mock.calls])).toMatch(
    /drift|HUB_TRUSTED_PROXY_HOPS|different|differ|match/i,
  )
  expect(await readFile(test.inputsPath, "utf8")).toBe(saved)
  expect(test.state.environment).toEqual(environment)
  expect(test.plans).toEqual([])
  expect(test.applies).toBe(0)
  expect(test.uploads).toEqual([])
})

it("rejects a secret-backed proxy hop setting before saving or mutating", async () => {
  const test = await scenario()
  const proxy = test.reference("protected-proxy-hops")
  test.inputs.runtime_secret_references!.HUB_TRUSTED_PROXY_HOPS = proxy
  delete test.inputs.runtime_environment_variables!.HUB_TRUSTED_PROXY_HOPS
  delete test.state.environment.HUB_TRUSTED_PROXY_HOPS
  test.secretValues.set("protected-proxy-hops", "2")
  const liveReferences = JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
  liveReferences.HUB_TRUSTED_PROXY_HOPS = proxy.secret_id
  test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
  const saved = JSON.stringify(test.inputs)
  await writeFile(test.inputsPath, saved, { mode: 0o600 })
  const environment = structuredClone(test.state.environment)
  await expect(
    installationInputs.readInstallationInputs(test.directory, test.target.config),
  ).resolves.toMatchObject({
    runtime_secret_references: { HUB_TRUSTED_PROXY_HOPS: proxy },
  })

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    }),
  ).rejects.toThrow(/proxy.*secret|secret.*proxy/i)

  expect(await readFile(test.inputsPath, "utf8")).toBe(saved)
  expect(test.state.environment).toEqual(environment)
  expect(test.plans).toEqual([])
  expect(test.applies).toBe(0)
  expect(test.uploads).toEqual([])
})

it("keeps desired inputs and runtime unchanged after prompt and signal cancellation, then resumes accepted IDs", async () => {
  const test = await scenario()
  const controller = new AbortController()
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    options?.signal?.throwIfAborted()
    return execute(executable, args, options)
  })
  test.inputs.hub_application_origin = test.origin
  await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
  test.state.environment.HUB_APPLICATION_ORIGIN = test.origin
  const original = await readFile(test.inputsPath, "utf8")
  const environment = structuredClone(test.state.environment)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockRejectedValueOnce(new DOMException("Synthetic credential cancellation", "AbortError"))

  await expect(
    postSetupAzure(test.target, {
      action: "github",
      run: test.run,
      ui: test.ui,
      request: test.request,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(await readFile(test.inputsPath, "utf8")).toBe(original)
  await expect(stat(join(test.directory, "post-desired.json"))).rejects.toMatchObject({
    code: "ENOENT",
  })
  expect(test.state.environment).toEqual(environment)
  expect(test.plans).toEqual([])
  expect(test.uploads).toEqual([])
  expect(test.leases.size).toBe(0)
  const releases = test.run.mock.calls.filter(
    ([, args]) => args.slice(0, 4).join(" ") === "storage blob lease release",
  )
  expect(releases).toHaveLength(2)
  for (const [, , options] of releases) expect(options?.signal?.aborted).toBe(false)
  expect(
    test.run.mock.calls.some(([, args]) =>
      ["restart", "activate", "deactivate", "set"].some((value) => args.includes(value)),
    ),
  ).toBe(false)
  const records = (await readdir(test.directory)).filter((name) => name.endsWith(".json"))
  const progress = await Promise.all(
    records
      .filter((name) => name !== "installation.tfvars.json")
      .map((name) => readFile(join(test.directory, name), "utf8")),
  )
  expect(JSON.stringify(progress)).toContain("Iv23synthetic")
  vi.mocked(test.ui.text)
    .mockReset()
    .mockImplementationOnce(async () => {
      controller.abort(new DOMException("Synthetic cancellation after resume", "AbortError"))
      controller.signal.throwIfAborted()
      return ""
    })
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) => {
    const resume = options.find((option) => /resume/i.test(option.label))
    expect(resume).toBeDefined()
    return resume!.value
  })

  await expect(
    postSetupAzure(test.target, {
      action: "github",
      run: test.run,
      ui: test.ui,
      request: test.request,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(vi.mocked(test.ui.text).mock.calls[0]![0]).toMatch(/client secret.*file/i)
  expect(await readFile(test.inputsPath, "utf8")).toBe(original)
  expect(test.uploads).toEqual([])
  expect(test.leases.size).toBe(0)
  expect(controller.signal.aborted).toBe(true)
  const allReleases = test.run.mock.calls.filter(
    ([, args]) => args.slice(0, 4).join(" ") === "storage blob lease release",
  )
  expect(allReleases).toHaveLength(4)
  for (const [, , options] of allReleases) expect(options?.signal?.aborted).toBe(false)
})

it("releases owned leases through the CLI command runner after the session is cancelled", async () => {
  const test = await scenario()
  const controller = new AbortController()
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    options?.signal?.throwIfAborted()
    return execute(executable, args, options)
  })
  test.inputs.hub_application_origin = test.origin
  await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
  test.state.environment.HUB_APPLICATION_ORIGIN = test.origin
  vi.mocked(test.ui.text).mockImplementationOnce(async () => {
    controller.abort(new DOMException("Synthetic CLI cancellation", "AbortError"))
    controller.signal.throwIfAborted()
    return ""
  })

  await expect(
    postSetupAzure(test.target, {
      action: "github",
      run: retryReadOnly(withDefaultSignal(test.run, controller.signal)),
      ui: test.ui,
      request: test.request,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" })

  const releases = test.run.mock.calls.filter(
    ([, args]) => args.slice(0, 4).join(" ") === "storage blob lease release",
  )
  expect(releases).toHaveLength(2)
  for (const [, , options] of releases) expect(options?.signal?.aborted).toBe(false)
  expect(test.leases.size).toBe(0)
})

it("retains desired inputs and owned leases after a failed apply and resumes the stopped Hub only on an explicit rerun", async () => {
  const test = await scenario()
  expect(test.state.environment.HUB_TRUSTED_PROXY_HOPS).toBe("1")
  test.state.failApply = true

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    }),
  ).rejects.toThrow("Synthetic apply failure")

  expect(JSON.parse(await readFile(test.inputsPath, "utf8"))).toMatchObject({
    image: test.image,
    deploy_hub: true,
    hub_application_origin: test.origin,
    runtime_secret_references: test.inputs.runtime_secret_references,
  })
  expect(test.plans).toHaveLength(1)
  expect(test.plans[0]!.desired.runtime_environment_variables?.HUB_TRUSTED_PROXY_HOPS).toBe("2")
  expect(test.plans[0]!.changed).toBe(true)
  expect(test.state.active).toBe(false)
  expect(test.applies).toBe(1)
  expect(test.leases.size).toBe(2)
  expect(test.request).not.toHaveBeenCalled()
  expect(test.ui.complete).not.toHaveBeenCalled()
  expect(test.ui.notice).toHaveBeenCalledWith("error", expect.stringMatching(/desired inputs/i))

  test.state.failApply = false
  await postSetupAzure(test.target, {
    action: "sign-in",
    run: test.run,
    ui: test.ui,
    request: test.request,
  })

  expect(test.plans).toHaveLength(2)
  expect(test.plans[0]!.path).not.toBe(test.plans[1]!.path)
  expect(test.plans[1]!.changed).toBe(true)
  expect(test.applies).toBe(2)
  expect(test.state.active).toBe(true)
  expect(test.leases.size).toBe(0)
  expect(test.ui.complete).toHaveBeenCalledOnce()
})

it("prints the final partial-change recovery summary and generated bootstrap path after a command failure", async () => {
  const test = await scenario()
  delete test.inputs.runtime_secret_references!.HUB_AUTHENTICATION_ENCRYPTION_KEY
  delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
  test.secretValues.clear()
  const liveReferences = JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
  delete liveReferences.HUB_AUTHENTICATION_ENCRYPTION_KEY
  delete liveReferences.HUB_BOOTSTRAP_SECRET
  test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
  await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
  test.state.failApply = true
  const entry = await import("../../installer/entry/index.ts")
  const terminal = await import("../../installer/terminal/index.tsx")
  const command = await import("../../installer/command/index.ts")
  const createTerminal = terminal.createTerminalUI
  const recoveryNotices: (string | undefined)[] = []
  let actualTerminal: ReturnType<typeof terminal.createTerminalUI> | undefined
  const renderer = vi.spyOn(terminal, "createTerminalUI").mockImplementation((abort, options) => {
    const ui = createTerminal(abort, options)
    actualTerminal = ui
    const recoveryNotice = ui.recoveryNotice!
    ui.recoveryNotice = (message) => {
      recoveryNotices.push(message)
      recoveryNotice(message)
    }
    ui.confirm = vi.fn(async () => true)
    ui.text = vi.fn(async (_label, initial) => (initial === test.origin ? test.origin : "2"))
    ui.select = vi.fn(async () => "exit")
    return ui
  })
  const select = vi.spyOn(entry, "selectInstallerEntry").mockResolvedValue({
    action: "update",
    path: test.target.path,
    existing: test.target.config,
    postAction: "sign-in",
  })
  const run = vi.spyOn(command, "runCommand").mockImplementation(test.run)
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
  const argv = process.argv
  const exitCode = process.exitCode
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  try {
    process.argv = [
      process.execPath,
      resolve("installer/index.tsx"),
      "--config",
      test.target.path,
      "--post",
      "--no-fullscreen",
    ]
    process.exitCode = undefined
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })

    await import("../../installer/index.tsx")

    const bootstrapFiles = (await readdir(test.directory)).filter((name) =>
      /^post-bootstrap-.*\.txt$/.test(name),
    )
    expect(bootstrapFiles).toHaveLength(1)
    const bootstrapPath = join(test.directory, bootstrapFiles[0]!)
    const output = errors.mock.calls.flat().map(String).join("\n")
    expect(process.exitCode).toBe(1)
    expect(test.applies).toBe(1)
    expect(test.uploads).toHaveLength(2)
    expect(recoveryNotices).toContain("Synthetic apply failure")
    expect(actualTerminal?.summary()).toMatch(/secrets or runtime changes may be partial/i)
    expect(output).toContain("Synthetic apply failure")
    expect(output).toMatch(/secrets or runtime changes may be partial/i)
    expect(output).toContain(bootstrapPath)
    expect(output).not.toContain(await readFile(bootstrapPath, "utf8"))
  } finally {
    process.argv = argv
    process.exitCode = exitCode
    if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY)
    else Reflect.deleteProperty(process.stdin, "isTTY")
    if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY)
    else Reflect.deleteProperty(process.stdout, "isTTY")
    renderer.mockRestore()
    select.mockRestore()
    run.mockRestore()
    errors.mockRestore()
  }
})

it.each([
  { stage: "before configuration changes", partial: false },
  { stage: "after a secret write", partial: true },
])("classifies an exit $stage in the CLI and telemetry", async ({ partial }) => {
  vi.resetModules()
  const test = await scenario()
  const entry = await import("../../installer/entry/index.ts")
  const terminal = await import("../../installer/terminal/index.tsx")
  const command = await import("../../installer/command/index.ts")
  if (partial) {
    delete test.inputs.runtime_secret_references!.HUB_AUTHENTICATION_ENCRYPTION_KEY
    delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
    test.secretValues.clear()
    const liveReferences = JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
    delete liveReferences.HUB_AUTHENTICATION_ENCRYPTION_KEY
    delete liveReferences.HUB_BOOTSTRAP_SECRET
    test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
    await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
    const execute = test.run.getMockImplementation()!
    test.run.mockImplementation(async (executable, args, options) => {
      if (
        executable === "az" &&
        args.slice(0, 3).join(" ") === "keyvault secret set" &&
        args[args.indexOf("--name") + 1] === "hub-bootstrap-secret"
      ) {
        expect(test.uploads.map(({ name }) => name)).toEqual([
          "hub-authentication-encryption-key",
        ])
        throw new command.CommandExecutionError("Synthetic secret write failure", false, 1)
      }
      return execute(executable, args, options)
    })
  }
  const originalInputs = await readFile(test.inputsPath, "utf8")
  const createTerminal = terminal.createTerminalUI
  let actualTerminal: ReturnType<typeof createTerminal> | undefined
  const renderer = vi.spyOn(terminal, "createTerminalUI").mockImplementation((abort, options) => {
    const ui = createTerminal(abort, options)
    actualTerminal = ui
    ui.confirm = vi.fn(async () => true)
    ui.text = vi.fn(async (_label, initial) =>
      partial ? (initial === test.origin ? test.origin : "2") : "not-an-origin",
    )
    ui.select = vi.fn<WizardUI["select"]>(async (_message, options) => {
      const exit = options.find((option) => option.value === "exit")
      expect(exit).toBeDefined()
      return exit!.value
    })
    return ui
  })
  const select = vi.spyOn(entry, "selectInstallerEntry").mockResolvedValue({
    action: "update",
    path: test.target.path,
    existing: test.target.config,
    postAction: "sign-in",
  })
  const run = vi.spyOn(command, "runCommand").mockImplementation(test.run)
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined)
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
  const argv = process.argv
  const exitCode = process.exitCode
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  try {
    process.argv = [
      process.execPath,
      resolve("installer/index.tsx"),
      "--config",
      test.target.path,
      "--post",
      "--no-fullscreen",
    ]
    process.exitCode = undefined
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true })
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })

    await import("../../installer/index.tsx")

    const logs = join(dirname(test.target.path), "logs")
    const [diagnostics] = await readdir(logs)
    const records = (await readFile(join(logs, diagnostics!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; name: string; status: string })
    const root = records.find(
      (record) => record.event === "span.completed" && record.name === "installer.run",
    )
    const printedErrors = errors.mock.calls.flat().map(String).join("\n")
    expect(await readFile(test.inputsPath, "utf8")).toBe(originalInputs)
    expect(test.plans).toEqual([])
    if (partial) {
      const bootstrapFiles = (await readdir(test.directory)).filter((name) =>
        /^post-bootstrap-.*\.txt$/.test(name),
      )
      expect(bootstrapFiles).toHaveLength(1)
      const bootstrapPath = join(test.directory, bootstrapFiles[0]!)
      expect(process.exitCode).toBe(1)
      expect(root).toMatchObject({ status: "error", attributes: { outcome: "failed" } })
      expect(test.uploads).toHaveLength(1)
      expect(test.leases.size).toBe(2)
      expect(actualTerminal?.summary()).toMatch(/secrets or runtime changes may be partial/i)
      expect(printedErrors).toMatch(/previous inputs were retained/i)
      expect(printedErrors).toContain(bootstrapPath)
      expect(printedErrors).not.toContain(await readFile(bootstrapPath, "utf8"))
    } else {
      expect(process.exitCode ?? 0).toBe(0)
      expect(root).toMatchObject({ status: "ok", attributes: { outcome: "completed" } })
      expect(test.uploads).toEqual([])
      expect(test.leases.size).toBe(0)
      expect(output.mock.calls.flat().map(String).join("\n")).toMatch(/post-setup stopped/i)
      expect(printedErrors).not.toMatch(/secrets or runtime changes may be partial/i)
    }
  } finally {
    process.argv = argv
    process.exitCode = exitCode
    if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY)
    else Reflect.deleteProperty(process.stdin, "isTTY")
    if (stdoutTTY) Object.defineProperty(process.stdout, "isTTY", stdoutTTY)
    else Reflect.deleteProperty(process.stdout, "isTTY")
    renderer.mockRestore()
    select.mockRestore()
    run.mockRestore()
    output.mockRestore()
    errors.mockRestore()
  }
})

it("retries pending GitHub secret versions only for the unchanged desired inputs and action without accepting unrelated live-reference drift", async () => {
  const test = await scenario()
  test.provider.revision = 1
  const sharedReferences = structuredClone(test.inputs.runtime_secret_references!)
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .trim()
  Object.assign(test.inputs, {
    hub_application_origin: test.origin,
    github_app_id: "123",
    github_client_id: "Iv23synthetic",
    github_app_installation_id: "456",
    github_provider_revision: 1,
  })
  Object.assign(test.inputs.runtime_secret_references!, {
    GITHUB_CLIENT_SECRET: test.reference("github-client-secret"),
    GITHUB_APP_PRIVATE_KEY_BASE64: test.reference("github-app-private-key"),
    GITHUB_WEBHOOK_SECRET: test.reference("github-webhook-secret"),
  })
  const liveReferences: Record<string, string> = {
    DATABASE_URL: test.reference("database-runtime").secret_id,
    ...Object.fromEntries(
      Object.entries(test.inputs.runtime_secret_references!).map(([key, value]) => [
        key,
        value.secret_id,
      ]),
    ),
  }
  Object.assign(test.state.environment, {
    HUB_APPLICATION_ORIGIN: test.origin,
    GITHUB_APP_ID: "123",
    GITHUB_CLIENT_ID: "Iv23synthetic",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_PROVIDER_REVISION: "1",
    AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(liveReferences),
  })
  await writeFile(test.inputsPath, JSON.stringify(test.inputs), { mode: 0o600 })
  test.secretValues.set("github-client-secret", "synthetic-old-client-secret")
  test.secretValues.set("github-app-private-key", Buffer.from(pem).toString("base64"))
  test.secretValues.set("github-webhook-secret", "synthetic-old-webhook-secret-for-tests")
  const values = ["synthetic-new-client-secret", pem, "synthetic-new-webhook-secret-for-tests"]
  const files = values.map((_, index) => join(test.directory, `credential-${index}`))
  await Promise.all(files.map((path, index) => writeFile(path, values[index]!, { mode: 0o600 })))
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(files[0]!)
    .mockResolvedValueOnce(files[1]!)
    .mockResolvedValueOnce(files[2]!)
    .mockResolvedValueOnce("2")
  test.state.github = true
  test.state.failApply = true

  await expect(
    postSetupAzure(test.target, {
      action: "github",
      run: test.run,
      ui: test.operatorUI,
      request: test.request,
    }),
  ).rejects.toThrow("Synthetic apply failure")

  const saved = await readFile(test.inputsPath, "utf8")
  const desired = JSON.parse(saved) as PostInputs
  expect(desired.github_provider_revision).toBe(2)
  expect(desired.runtime_secret_references).toMatchObject(sharedReferences)
  expect(test.uploads).toHaveLength(3)
  for (const [key, name] of [
    ["GITHUB_CLIENT_SECRET", "github-client-secret"],
    ["GITHUB_APP_PRIVATE_KEY_BASE64", "github-app-private-key"],
    ["GITHUB_WEBHOOK_SECRET", "github-webhook-secret"],
  ] as const) {
    expect(desired.runtime_secret_references![key]).toEqual(test.reference(name, "b".repeat(32)))
    expect(desired.runtime_secret_references![key]!.secret_id).not.toBe(liveReferences[key])
  }
  const journal = join(test.directory, "post-desired.json")
  const evidence = JSON.parse(await readFile(journal, "utf8")) as {
    target: string
    hash: string
    action: string
    phase: string
  }
  expect(JSON.parse(evidence.target)).toEqual(test.target.config)
  expect(evidence).toMatchObject({
    hash: createHash("sha256").update(saved).digest("hex"),
    action: "github",
    phase: "pending",
  })
  expect((await stat(journal)).mode & 0o777).toBe(0o600)
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.operatorUI,
      request: test.request,
    }),
  ).rejects.toThrow(/pending.*github/i)
  await writeFile(test.inputsPath, `${saved}\n`, { mode: 0o600 })
  await expect(
    postSetupAzure(test.target, {
      action: "github",
      run: test.run,
      ui: test.operatorUI,
      request: test.request,
    }),
  ).rejects.toThrow(/pending|evidence|inputs.*match/i)
  await writeFile(test.inputsPath, saved, { mode: 0o600 })
  test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify({
    ...liveReferences,
    SERVICE_API_KEY: test.reference("service-api-key", "c".repeat(32)).secret_id,
  })
  await expect(
    postSetupAzure(test.target, {
      action: "github",
      run: test.run,
      ui: test.operatorUI,
      request: test.request,
    }),
  ).rejects.toThrow(/references.*differ/i)
  expect(test.applies).toBe(1)
  expect(test.ui.text).toHaveBeenCalledTimes(7)
  expect(await readFile(test.inputsPath, "utf8")).toBe(saved)
  test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
  test.state.failApply = false

  await postSetupAzure(test.target, {
    action: "github",
    run: test.run,
    ui: test.operatorUI,
    request: test.request,
  })

  expect(test.applies).toBe(2)
  expect(test.plans).toHaveLength(2)
  expect(test.plans[0]!.path).not.toBe(test.plans[1]!.path)
  expect(test.uploads).toHaveLength(3)
  expect(JSON.parse(await readFile(test.inputsPath, "utf8"))).toEqual(desired)
  expect(JSON.parse(test.state.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)).toEqual({
    DATABASE_URL: liveReferences.DATABASE_URL,
    ...Object.fromEntries(
      Object.entries(desired.runtime_secret_references!).map(([key, value]) => [
        key,
        value.secret_id,
      ]),
    ),
  })
  expect(JSON.parse(await readFile(journal, "utf8"))).toMatchObject({ phase: "complete" })
  expect(test.leases.size).toBe(0)
})

it("regenerates and revalidates the plan on an explicit apply retry, blocking new foreign drift", async () => {
  const test = await scenario()
  expect(test.state.environment.HUB_TRUSTED_PROXY_HOPS).toBe("1")
  test.state.failApply = true
  test.state.foreignRetryPlan = true
  test.state.recovery = "retry"

  await expect(
    postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    }),
  ).rejects.toThrow(/plan blocked/i)

  expect(test.plans).toHaveLength(2)
  expect(test.plans[0]!.changed).toBe(true)
  expect(test.plans[0]!.path).not.toBe(test.plans[1]!.path)
  expect(test.applies).toBe(1)
  expect(test.ui.text).toHaveBeenCalledTimes(2)
  expect(test.leases.size).toBe(2)
  expect(test.ui.complete).not.toHaveBeenCalled()
})

it.each(["duplicate", "lookup failure", "absent"] as const)(
  "applies a secret read grant only after a conclusive clean Azure lookup: %s",
  async (lookup) => {
    const test = await scenario()
    const reference = test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET!
    const scope = `${reference.key_vault_id}/secrets/hub-bootstrap-secret`
    const principalId = "00000000-0000-0000-0000-000000000003"
    const grantId = `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000004`
    const environment = structuredClone(test.state.environment)
    const execute = test.run.getMockImplementation()!
    const checkGrant = vi.fn(async () => {
      if (lookup === "lookup failure") throw new Error("Synthetic Azure lookup failure")
      return JSON.stringify(
        lookup === "absent"
          ? []
          : [{ id: grantId, scope, principalId, roleDefinitionName: "Key Vault Secrets User" }],
      )
    })
    test.run.mockImplementation(async (executable, args, options) => {
      if (executable === "az" && args.slice(0, 3).join(" ") === "role assignment list") {
        expect(args[args.indexOf("--scope") + 1]).toBe(scope)
        return checkGrant()
      }
      const output = await execute(executable, args, options)
      if (executable !== "terraform" || args[1] !== "show" || !args[3]) return output
      const plan = JSON.parse(output)
      plan.resource_changes.push({
        address: `azurerm_role_assignment.runtime_secrets[${JSON.stringify(scope)}]`,
        mode: "managed",
        type: "azurerm_role_assignment",
        change: {
          actions: ["create"],
          before: null,
          after: {
            scope,
            principal_id: principalId,
            role_definition_name: "Key Vault Secrets User",
          },
        },
      })
      return JSON.stringify(plan)
    })

    const result = postSetupAzure(test.target, {
      action: "sign-in",
      run: test.run,
      ui: test.ui,
      request: test.request,
    })
    if (lookup === "absent") {
      await expect(result).resolves.toContain(test.origin)
      expect(checkGrant).toHaveBeenCalledOnce()
      expect(test.applies).toBe(1)
      expect(test.state.environment.HUB_TRUSTED_PROXY_HOPS).toBe("2")
      return
    }

    await expect(result).rejects.toThrow(
      lookup === "duplicate" ? /plan blocked.*already has resources/i : /plan blocked/i,
    )

    expect(checkGrant).toHaveBeenCalledOnce()
    expect(test.plans).toHaveLength(1)
    expect(test.plans[0]!.changed).toBe(true)
    expect(test.applies).toBe(0)
    expect(test.ui.confirm).toHaveBeenCalledTimes(1)
    expect(test.state.active).toBe(true)
    expect(test.state.environment).toEqual(environment)
    expect(
      test.run.mock.calls.some(
        ([executable, args]) =>
          (executable === "terraform" && ["import", "state"].includes(args[1]!)) ||
          (executable === "az" &&
            (args.slice(0, 3).join(" ") === "containerapp revision deactivate" ||
              (args[0] === "role" && ["create", "delete"].includes(args[2]!)))),
      ),
    ).toBe(false)
  },
)

it.each(["lease conflict", "active setup job", "cancellation during target lookup"] as const)(
  "stops before runtime or secret mutation for %s",
  async (blocker) => {
    const test = await scenario()
    const controller = new AbortController()
    if (blocker === "lease conflict") test.state.locked = true
    if (blocker === "active setup job") test.state.activeJob = true
    if (blocker === "cancellation during target lookup")
      test.state.afterAccount = () => controller.abort(new DOMException("Cancelled", "AbortError"))

    await expect(
      postSetupAzure(test.target, {
        action: "sign-in",
        run: test.run,
        ui: test.ui,
        request: test.request,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(Error)

    expect(test.applies).toBe(0)
    expect(test.plans).toEqual([])
    expect(test.ui.text).not.toHaveBeenCalled()
    expect(await readFile(test.inputsPath, "utf8")).toBe(test.original)
    expect(
      test.run.mock.calls.some(([, args]) =>
        ["restart", "activate", "deactivate", "set", "delete", "break"].some((value) =>
          args.includes(value),
        ),
      ),
    ).toBe(false)
  },
)
