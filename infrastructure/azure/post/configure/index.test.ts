import { generateKeyPairSync, randomUUID } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import * as privateFiles from "../../../installer/private-files/index.ts"
import type { RunCommand, WizardUI } from "../../../installer/types.ts"
import { installationNames } from "../../install/settings.ts"
import type { AzureInstallation } from "../../install/types.ts"
import { PostSetupExit } from "../errors.ts"
import { postSetupProgress } from "../progress/index.ts"
import type { PostDeployment, PostInputs } from "../types.ts"
import { configurePostSetup } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario() {
  const directory = resolve(`.post-configure-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const config: AzureInstallation["config"] = {
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
  const names = installationNames(config)
  const vaultId = `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${names.foundationGroup}/providers/Microsoft.KeyVault/vaults/${names.vault}`
  const reference = (name: string, version = "a".repeat(32)) => ({
    key_vault_id: vaultId,
    secret_id: `https://${names.vault}.vault.azure.net/secrets/${name}/${version}`,
  })
  const inputs: PostInputs = {
    image: `registry.azurecr.io/hub@sha256:${"a".repeat(64)}`,
    deploy_hub: true,
    runtime_environment_variables: { PUBLIC_SETTING: "retained", EMPTY_SETTING: "" },
    runtime_secret_references: {
      SERVICE_API_KEY: reference("unrelated-service-key"),
      HUB_AUTHENTICATION_ENCRYPTION_KEY: reference("hub-authentication-encryption-key"),
      HUB_BOOTSTRAP_SECRET: reference("hub-bootstrap-secret"),
    },
    postgres_sku: "GP_Standard_D2s_v3",
    postgres_version: "17",
    backup_retention_days: 14,
  }
  const deployment: PostDeployment = {
    appId: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/containerApps/sample-hub-hub`,
    appName: "sample-hub-hub",
    environmentId: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/managedEnvironments/sample-hub-environment`,
    image: inputs.image,
    revision: "sample-hub-hub--active",
    active: true,
    origin: "https://sample-hub.eastus2.azurecontainerapps.io",
    customHosts: ["bound.example.com"],
    principalId: "00000000-0000-0000-0000-000000000003",
    environment: {
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(
        Object.fromEntries(
          Object.entries(inputs.runtime_secret_references!).map(([key, value]) => [
            key,
            value.secret_id,
          ]),
        ),
      ),
    },
  }
  const secrets = new Map([
    ["hub-authentication-encryption-key", Buffer.alloc(32, 7).toString("base64")],
    ["hub-bootstrap-secret", "synthetic-bootstrap-secret-for-tests-only"],
  ])
  const uploads: { name: string; path: string; value: string }[] = []
  const run = vi.fn<RunCommand>(async (executable, args) => {
    expect(executable).toBe("az")
    expect(args.slice(0, 2)).toEqual(["keyvault", "secret"])
    if (args[2] === "list") return JSON.stringify([...secrets.keys()])
    if (args[2] === "show") {
      const id = args[args.indexOf("--id") + 1]!
      const name = new URL(id).pathname.split("/")[2]!
      expect(secrets.has(name)).toBe(true)
      return JSON.stringify({
        value: secrets.get(name),
        id: /\/[a-f0-9]{32}$/i.test(id) ? id : reference(name).secret_id,
        enabled: true,
      })
    }
    if (args[2] === "set") {
      expect(args).not.toContain("--value")
      const path = args[args.indexOf("--file") + 1]!
      const name = args[args.indexOf("--name") + 1]!
      expect((await stat(path)).mode & 0o777).toBe(0o600)
      const value = await readFile(path, "utf8")
      uploads.push({ path, name, value })
      secrets.set(name, value)
      return JSON.stringify(reference(name).secret_id)
    }
    throw new Error("Unexpected Key Vault command")
  })
  const ui: WizardUI = {
    cloud: vi.fn(),
    select: vi.fn<WizardUI["select"]>(async (_message, options) => {
      const choice =
        options.find((option) => /resume/i.test(option.label)) ??
        options.find((option) => /edit/i.test(option.label)) ??
        options.find((option) => /exit/i.test(option.label))
      expect(choice).toBeDefined()
      return choice!.value
    }),
    text: vi.fn(),
    confirm: vi.fn(),
    status: vi.fn(),
    notice: vi.fn(),
    wait: vi.fn(),
  }
  const provider = {
    revision: 0,
    enabled: true,
    confirmed: true,
    confirmations: 0,
    verifications: 0,
    enabledChecks: 0,
    enabledPrompt: "",
    allowReactivation: vi.fn(async (_message: string) => true),
  }
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
          if (/Explicitly allow GitHub sign-in to be enabled/i.test(message))
            return provider.allowReactivation(message)
          if (/last stored GitHub provider revision/i.test(message)) {
            provider.confirmations++
            return provider.confirmed
          }
          if (/provider/i.test(message) && /enabled/i.test(message)) {
            provider.enabledChecks++
            provider.enabledPrompt = message
            return provider.enabled
          }
          return target.confirm(message)
        }
      return Reflect.get(target, key, receiver)
    },
  })
  let finishProgress: (() => Promise<void>) | undefined
  const context: AzureInstallation & {
    ui: WizardUI
    onPrepared?(finish: () => Promise<void>): void
  } = {
    directory,
    config,
    run,
    env: {},
    ui: operatorUI,
    azure: (...args) => run("az", args),
    onPrepared: (finish) => {
      finishProgress = finish
    },
  }
  return {
    context,
    inputs,
    deployment,
    secrets,
    uploads,
    reference,
    run,
    ui,
    provider,
    async finish() {
      expect(finishProgress).toBeDefined()
      await finishProgress!()
    },
  }
}

async function githubCredentials(test: Awaited<ReturnType<typeof scenario>>) {
  test.inputs.hub_application_origin = test.deployment.origin
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .trim()
  const values = ["synthetic-client-secret", pem, "synthetic-webhook-secret-for-tests-only"]
  const paths = ["client secret", "rsa private key.pem", "webhook secret"].map((name) =>
    join(test.context.directory, name),
  )
  await Promise.all(paths.map((path, index) => writeFile(path, values[index]!, { mode: 0o600 })))
  return { paths, values }
}

async function configuredGithub(test: Awaited<ReturnType<typeof scenario>>) {
  const credentials = await githubCredentials(test)
  test.provider.revision = 4
  Object.assign(test.inputs, {
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
  test.secrets.set("github-client-secret", credentials.values[0]!)
  test.secrets.set(
    "github-app-private-key",
    Buffer.from(credentials.values[1]!).toString("base64"),
  )
  test.secrets.set("github-webhook-secret", credentials.values[2]!)
  Object.assign(test.deployment.environment, {
    HUB_APPLICATION_ORIGIN: test.deployment.origin,
    GITHUB_APP_ID: "123",
    GITHUB_CLIENT_ID: "Iv23synthetic",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_PROVIDER_REVISION: "4",
    AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(
      Object.fromEntries(
        Object.entries(test.inputs.runtime_secret_references!).map(([key, value]) => [
          key,
          value.secret_id,
        ]),
      ),
    ),
  })
  return credentials
}

function returnSecretId(
  test: Awaited<ReturnType<typeof scenario>>,
  requestedId: string,
  returnedId: string,
) {
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    const result = await execute(executable, args, options)
    if (args[2] === "show" && args[args.indexOf("--id") + 1] === requestedId)
      return JSON.stringify({ ...JSON.parse(result), id: returnedId })
    return result
  })
}

async function progressContents(directory: string) {
  return Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .map((name) => readFile(join(directory, name), "utf8")),
  )
}

function choose(options: { label: string; value: string }[], label: RegExp) {
  const choice = options.find((option) => label.test(option.label))
  expect(choice, `Expected a choice matching ${label}`).toBeDefined()
  return choice!.value
}

async function otherFiles(directory: string) {
  return (await readdir(directory)).filter((name) => !name.endsWith("-progress.json"))
}

function expectNoCredentials(visible: string, values: readonly string[]) {
  for (const value of values)
    for (const line of value.split(/\r?\n/).filter(Boolean)) expect(visible).not.toContain(line)
}

it("validates the authoritative origin and explicit proxy hops while preserving shared keys and unrelated settings across repeats", async () => {
  const test = await scenario()
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("https://unbound.example.com")
    .mockResolvedValueOnce("https://bound.example.com")
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("0")
    .mockResolvedValueOnce("11")
    .mockResolvedValueOnce("10")

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(vi.mocked(test.ui.text).mock.calls[0]![1]).toBe(test.deployment.origin)
  expect(test.ui.notice).toHaveBeenCalledWith("error", expect.any(String))
  expect(desired).toEqual({
    ...original,
    hub_application_origin: "https://bound.example.com",
    runtime_environment_variables: {
      ...original.runtime_environment_variables,
      HUB_TRUSTED_PROXY_HOPS: "10",
    },
  })
  expect(test.inputs).toEqual(original)
  await test.finish()
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial!)

  expect(await configurePostSetup(test.context, "sign-in", desired, test.deployment)).toEqual(
    desired,
  )
  expect(test.uploads).toEqual([])
  expect(await otherFiles(test.context.directory)).toEqual([])
})

it.each([
  ["origin", "https://bound.example.com", "2"],
  ["proxy hop count", "https://sample-hub.eastus2.azurecontainerapps.io", "3"],
])("blocks changing the %s while the private prototype service serves Hub", async (_, origin, hops) => {
  const test = await scenario()
  await configuredGithub(test)
  Object.assign(test.inputs.runtime_environment_variables!, {
    HUB_TRUSTED_PROXY_HOPS: "2",
    HUB_PRIVATE_PREVIEW_ENABLED: "true",
  })
  const original = structuredClone(test.inputs)
  const files = await otherFiles(test.context.directory)
  vi.mocked(test.ui.text).mockImplementation(async (label) =>
    label.startsWith("Public HTTPS origin") ? origin : hops,
  )

  await expect(
    configurePostSetup(test.context, "sign-in", test.inputs, test.deployment),
  ).rejects.toThrow(PostSetupExit)

  expect(test.inputs).toEqual(original)
  expect(test.run.mock.calls.filter(([, args]) => args[2] === "set")).toEqual([])
  expect(await otherFiles(test.context.directory)).toEqual(files)
  expect(test.provider.allowReactivation).not.toHaveBeenCalled()
  expect(test.provider.verifications).toBe(0)
})

it.each([
  ["origin", "https://bound.example.com", "2"],
  ["proxy hop count Hub is serving with", "https://sample-hub.eastus2.azurecontainerapps.io", "3"],
])("blocks changing the %s when only the serving Hub plays private Builds", async (_, origin, hops) => {
  const test = await scenario()
  await configuredGithub(test)
  // A workflow release turned playback on; the saved inputs do not say so.
  Object.assign(test.deployment.environment, { HUB_PRIVATE_PREVIEW_ENABLED: "true", HUB_TRUSTED_PROXY_HOPS: "2" })
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text).mockImplementation(async (label) =>
    label.startsWith("Public HTTPS origin") ? origin : hops,
  )

  await expect(
    configurePostSetup(test.context, "sign-in", test.inputs, test.deployment),
  ).rejects.toThrow(PostSetupExit)

  expect(test.inputs).toEqual(original)
  expect(test.run.mock.calls.filter(([, args]) => args[2] === "set")).toEqual([])
})

it("rejects a bound hostname with an unbound port and accepts its canonical HTTPS origin", async () => {
  const test = await scenario()
  test.deployment.customHosts = ["BoUnD.ExAmPlE.CoM"]
  const origins = ["https://bound.example.com:8443", "https://bound.example.com"]
  vi.mocked(test.ui.text).mockImplementation(async (label) =>
    label.startsWith("Public HTTPS origin") ? origins.shift()! : "2",
  )

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.hub_application_origin).toBe("https://bound.example.com")
  expect(test.ui.notice).toHaveBeenCalledWith("error", expect.any(String))
  expect(test.uploads).toEqual([])
})

it("keeps an unchanged origin available when Entra is configured", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  Object.assign(test.inputs.runtime_environment_variables!, {
    ENTRA_OIDC_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
    ENTRA_OIDC_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
    ENTRA_OIDC_PROVIDER_REVISION: "4",
  })
  Object.assign(test.deployment.environment, test.inputs.runtime_environment_variables, {
    HUB_APPLICATION_ORIGIN: test.deployment.origin,
  })
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
    label.startsWith("Public HTTPS origin") ? initial! : "2",
  )

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.hub_application_origin).toBe(test.deployment.origin)
  expect(desired.runtime_environment_variables).toMatchObject(
    test.inputs.runtime_environment_variables!,
  )
  expect(test.uploads).toEqual([])
})

it("rechecks the stored GitHub revision when changing origin with only a saved revision", async () => {
  const test = await scenario()
  await configuredGithub(test)
  delete test.deployment.environment.GITHUB_PROVIDER_REVISION
  vi.mocked(test.ui.text).mockImplementation(async (label) =>
    label.startsWith("Public HTTPS origin") ? "https://bound.example.com" : "2",
  )

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.github_provider_revision).toBe(5)
  expect(test.provider.verifications).toBe(1)
  expect(test.uploads).toEqual([])
})

it("preserves inputs and creates no secrets when enabling a disabled provider through an origin change is declined", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.provider.enabled = false
  test.provider.allowReactivation.mockResolvedValue(false)
  delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
  test.secrets.delete("hub-bootstrap-secret")
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text).mockImplementation(async (label) =>
    label.startsWith("Public HTTPS origin") ? "https://bound.example.com" : "2",
  )

  await expect(
    configurePostSetup(test.context, "sign-in", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(PostSetupExit)

  expect(test.provider.allowReactivation).toHaveBeenCalledOnce()
  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
  expect(test.secrets.has("hub-bootstrap-secret")).toBe(false)
})

it("advances a disabled provider only after fresh origin-change consent, including on resume", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.provider.enabled = false
  test.provider.allowReactivation.mockImplementation(async (message) => {
    expect(test.provider.verifications).toBe(1)
    expect(message).toMatch(/will enable GitHub sign-in.*even if.*disabled/i)
    return true
  })
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text).mockImplementation(async (label) =>
    label.startsWith("Public HTTPS origin") ? "https://bound.example.com" : "2",
  )

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(test.provider.allowReactivation).toHaveBeenCalledOnce()
  expect(desired.hub_application_origin).toBe("https://bound.example.com")
  expect(desired.github_provider_revision).toBe(5)
  test.provider.allowReactivation.mockResolvedValue(false)

  await expect(
    configurePostSetup(test.context, "sign-in", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(PostSetupExit)

  expect(test.provider.allowReactivation).toHaveBeenCalledTimes(2)
  expect(test.provider.verifications).toBe(2)
  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
})

it("rejects an overlong bound origin before accepting a corrected origin", async () => {
  const test = await scenario()
  const host = "a".repeat(493)
  test.deployment.customHosts.push(host)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce(`https://${host}`)
    .mockResolvedValueOnce("https://bound.example.com")
    .mockResolvedValueOnce("2")

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.hub_application_origin).toBe("https://bound.example.com")
  expect(test.ui.notice).toHaveBeenCalledWith("error", expect.stringMatching(/HTTPS origin/i))
  expect(test.uploads).toEqual([])
})

it("keeps the recovery error until the corrected answer is saved before asking the next question", async () => {
  const test = await scenario()
  const progressPath = join(test.context.directory, "post-sign-in-progress.json")
  let recoveryError: string | undefined
  let correctionError: string | undefined
  let nextQuestionError: string | undefined
  let nextQuestionAnswers: unknown
  test.ui.recoveryNotice = vi.fn((message) => {
    recoveryError = message
  })
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("https://unbound.example.com")
    .mockImplementationOnce(async () => {
      correctionError = recoveryError
      return test.deployment.origin
    })
    .mockImplementationOnce(async () => {
      nextQuestionError = recoveryError
      nextQuestionAnswers = JSON.parse(await readFile(progressPath, "utf8")).answers
      return "2"
    })
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) => {
    return choose(options, /edit/i)
  })
  const write = privateFiles.writePrivateFile
  let saving = false
  let releaseSave = () => {}
  const saveAllowed = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  vi.spyOn(privateFiles, "writePrivateFile").mockImplementation(async (path, ...args) => {
    if (path === progressPath && !saving) {
      saving = true
      await saveAllowed
    }
    return write(path, ...args)
  })
  const pending = configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)
  void pending.catch(() => {})
  try {
    await vi.waitFor(() => expect(saving).toBe(true))
    expect(correctionError).toBeDefined()
    expect(recoveryError).toBe(correctionError)
    await expect(readFile(progressPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    releaseSave()
  }

  const desired = await pending

  expect(nextQuestionError).toBeUndefined()
  expect(nextQuestionAnswers).toMatchObject({ origin: test.deployment.origin })
  expect(desired.hub_application_origin).toBe(test.deployment.origin)
  expect(desired.runtime_environment_variables?.HUB_TRUSTED_PROXY_HOPS).toBe("2")
  expect(test.ui.notice).not.toHaveBeenCalled()
})

it("reuses shared secrets already created in the vault when an interrupted run has not saved their references", async () => {
  const test = await scenario()
  delete test.inputs.runtime_secret_references!.HUB_AUTHENTICATION_ENCRYPTION_KEY
  delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
  const before = new Map(test.secrets)
  vi.mocked(test.ui.text).mockResolvedValueOnce(test.deployment.origin).mockResolvedValueOnce("2")

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.runtime_secret_references).toEqual({
    ...test.inputs.runtime_secret_references,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: test.reference("hub-authentication-encryption-key"),
    HUB_BOOTSTRAP_SECRET: test.reference("hub-bootstrap-secret"),
  })
  expect(test.secrets).toEqual(before)
  expect(test.uploads).toEqual([])
  expect(await otherFiles(test.context.directory)).toEqual([])
})

it("pins the exact version read from an existing unversioned shared secret", async () => {
  const test = await scenario()
  const key = "HUB_AUTHENTICATION_ENCRYPTION_KEY"
  const pinned = test.reference("hub-authentication-encryption-key", "b".repeat(32))
  const unversioned = {
    ...pinned,
    secret_id: pinned.secret_id.replace(/\/[a-f0-9]{32}$/, ""),
  }
  test.inputs.runtime_secret_references![key] = unversioned
  const original = structuredClone(test.inputs)
  returnSecretId(test, unversioned.secret_id, pinned.secret_id)
  vi.mocked(test.ui.text).mockResolvedValueOnce(test.deployment.origin).mockResolvedValueOnce("2")

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.runtime_secret_references![key]).toEqual(pinned)
  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
})

it.each(["vault", "secret name", "pinned version"] as const)(
  "rejects a shared secret response with a different %s",
  async (mismatch) => {
    const test = await scenario()
    const key = "HUB_AUTHENTICATION_ENCRYPTION_KEY"
    const name = "hub-authentication-encryption-key"
    const requested = test.reference(name)
    if (mismatch !== "pinned version")
      requested.secret_id = requested.secret_id.replace(/\/[a-f0-9]{32}$/, "")
    test.inputs.runtime_secret_references![key] = requested
    const original = structuredClone(test.inputs)
    const returned =
      mismatch === "vault"
        ? test.reference(name).secret_id.replace(/https:\/\/[^.]+/, "https://different-vault")
        : test.reference(mismatch === "secret name" ? "another-secret" : name, "b".repeat(32))
            .secret_id
    returnSecretId(test, requested.secret_id, returned)
    vi.mocked(test.ui.text).mockResolvedValueOnce(test.deployment.origin).mockResolvedValueOnce("2")

    await expect(
      configurePostSetup(test.context, "sign-in", test.inputs, test.deployment),
    ).rejects.toThrow()

    expect(test.inputs).toEqual(original)
    expect(test.uploads).toEqual([])
  },
)

it("resolves an uncertain bootstrap write before creating another shared secret", async () => {
  const test = await scenario()
  delete test.inputs.runtime_secret_references!.HUB_AUTHENTICATION_ENCRYPTION_KEY
  delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
  test.secrets.clear()
  const progress = await postSetupProgress(test.context, "sign-in", test.inputs)
  await progress.pendingUpload("HUB_BOOTSTRAP_SECRET")
  vi.mocked(test.ui.text).mockResolvedValueOnce(test.deployment.origin).mockResolvedValueOnce("2")

  await expect(
    configurePostSetup(test.context, "sign-in", test.inputs, test.deployment),
  ).rejects.toThrow(/saved answers.*preserved/i)

  expect(test.uploads).toEqual([])
  expect((await postSetupProgress(test.context, "sign-in", test.inputs)).pending).toBe(
    "HUB_BOOTSTRAP_SECRET",
  )
})

it("keeps the GitHub provider revision when the existing origin is supplied through Key Vault", async () => {
  const test = await scenario()
  test.provider.enabled = false
  test.inputs.runtime_secret_references!.HUB_APPLICATION_ORIGIN =
    test.reference("hub-application-origin")
  test.secrets.set("hub-application-origin", test.deployment.origin)
  test.inputs.github_provider_revision = 4
  test.deployment.environment.GITHUB_PROVIDER_REVISION = "4"
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial || "1")

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(desired.github_provider_revision).toBe(4)
  expect(desired.hub_application_origin).toBeUndefined()
  expect(desired.runtime_secret_references).toEqual(test.inputs.runtime_secret_references)
  expect(test.uploads).toEqual([])
  expect(test.provider.allowReactivation).not.toHaveBeenCalled()
})

it("creates absent shared secrets through private files and reuses their pinned references and bootstrap recovery file on rerun", async () => {
  const test = await scenario()
  delete test.inputs.runtime_secret_references!.HUB_AUTHENTICATION_ENCRYPTION_KEY
  delete test.inputs.runtime_secret_references!.HUB_BOOTSTRAP_SECRET
  test.secrets.clear()
  vi.mocked(test.ui.text).mockResolvedValueOnce(test.deployment.origin).mockResolvedValueOnce("2")

  const desired = await configurePostSetup(test.context, "sign-in", test.inputs, test.deployment)

  expect(test.uploads.map(({ name }) => name).sort()).toEqual([
    "hub-authentication-encryption-key",
    "hub-bootstrap-secret",
  ])
  const encryptionKey = test.secrets.get("hub-authentication-encryption-key")!
  const bootstrap = test.secrets.get("hub-bootstrap-secret")!
  expect(Buffer.from(encryptionKey, "base64")).toHaveLength(32)
  expect(Buffer.from(encryptionKey, "base64").toString("base64")).toBe(encryptionKey)
  expect(bootstrap.length).toBeGreaterThanOrEqual(32)
  expect(bootstrap.length).toBeLessThanOrEqual(2_000)
  expect(bootstrap).toMatch(/^\S+$/)
  expect(desired.runtime_secret_references).toEqual({
    ...test.inputs.runtime_secret_references,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: test.reference("hub-authentication-encryption-key"),
    HUB_BOOTSTRAP_SECRET: test.reference("hub-bootstrap-secret"),
  })
  expect((await stat(test.context.directory)).mode & 0o777).toBe(0o700)
  const recoveryFiles = await otherFiles(test.context.directory)
  expect(recoveryFiles).toHaveLength(1)
  const recovery = join(test.context.directory, recoveryFiles[0]!)
  expect((await stat(recovery)).mode & 0o777).toBe(0o600)
  expect(await readFile(recovery, "utf8")).toBe(bootstrap)
  for (const { path } of test.uploads)
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" })
  const visible = JSON.stringify([
    desired,
    test.run.mock.calls,
    vi.mocked(test.ui.status).mock.calls,
    vi.mocked(test.ui.notice!).mock.calls,
  ])
  expectNoCredentials(visible, [encryptionKey, bootstrap])
  await test.finish()
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial!)

  expect(await configurePostSetup(test.context, "sign-in", desired, test.deployment)).toEqual(
    desired,
  )
  expect(test.uploads).toHaveLength(2)
  expect(test.secrets.get("hub-authentication-encryption-key")).toBe(encryptionKey)
  expect(test.secrets.get("hub-bootstrap-secret")).toBe(bootstrap)
  expect(await otherFiles(test.context.directory)).toEqual(recoveryFiles)
  expect(await readFile(recovery, "utf8")).toBe(bootstrap)
})

it("uploads GitHub credentials only through private files, encodes an RSA PEM, and returns only pinned references", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .trim()
  const values = ["synthetic-client-secret", pem, "synthetic-webhook-secret-for-tests-only"]
  const paths = values.map((_, index) => join(test.context.directory, `credential-${index}`))
  await Promise.all(paths.map((path, index) => writeFile(path, values[index]!, { mode: 0o600 })))
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("-1")
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("0")
    .mockResolvedValueOnce("1")

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(desired).toMatchObject({
    github_app_id: "123",
    github_client_id: "Iv23synthetic",
    github_app_installation_id: "456",
    github_provider_revision: 1,
    runtime_environment_variables: test.inputs.runtime_environment_variables,
    runtime_secret_references: {
      ...test.inputs.runtime_secret_references,
      GITHUB_CLIENT_SECRET: test.reference("github-client-secret"),
      GITHUB_APP_PRIVATE_KEY_BASE64: test.reference("github-app-private-key"),
      GITHUB_WEBHOOK_SECRET: test.reference("github-webhook-secret"),
    },
  })
  expect(test.uploads.map(({ value }) => value)).toEqual([
    values[0],
    Buffer.from(pem).toString("base64"),
    values[2],
  ])
  for (const { path } of test.uploads)
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" })
  const visible = JSON.stringify([
    desired,
    test.run.mock.calls,
    vi.mocked(test.ui.status).mock.calls,
  ])
  const notices = JSON.stringify(vi.mocked(test.ui.notice!).mock.calls)
  expectNoCredentials(visible, [...values, Buffer.from(pem).toString("base64")])
  expectNoCredentials(notices, [...values, Buffer.from(pem).toString("base64")])
})

it.each(["padding and quotes", "home and escaped spaces"] as const)(
  "accepts credential paths with %s without losing internal spaces",
  async (style) => {
    const test = await scenario()
    const { paths, values } = await githubCredentials(test)
    vi.stubEnv("HOME", test.context.directory)
    const supplied =
      style === "padding and quotes"
        ? [` \t${paths[0]}  `, ` "${paths[1]}" `, ` '${paths[2]}' `]
        : ["~/client secret", paths[1]!.replaceAll(" ", "\\ "), "~/webhook\\ secret"]
    vi.mocked(test.ui.text)
      .mockResolvedValueOnce("123")
      .mockResolvedValueOnce("Iv23synthetic")
      .mockResolvedValueOnce("456")
      .mockResolvedValueOnce(supplied[0]!)
      .mockResolvedValueOnce(supplied[1]!)
      .mockResolvedValueOnce(supplied[2]!)
      .mockResolvedValueOnce("1")

    const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

    expect(desired.github_app_id).toBe("123")
    expect(test.uploads.map(({ value }) => value)).toEqual([
      values[0],
      Buffer.from(values[1]!).toString("base64"),
      values[2],
    ])
    const saved = JSON.stringify(await progressContents(test.context.directory))
    for (const path of paths) expect(saved).toContain(path)
    expectNoCredentials(saved, [...values, Buffer.from(values[1]!).toString("base64")])
  },
)

it("rechecks permission, missing-file and content corrections without repeating accepted IDs or paths", async () => {
  const test = await scenario()
  const { paths, values } = await githubCredentials(test)
  const keyDirectory = join(test.context.directory, "private key directory")
  await mkdir(keyDirectory, { mode: 0o700 })
  const key = join(keyDirectory, "rsa private key.pem")
  await rename(paths[1]!, key)
  paths[1] = key
  await chmod(keyDirectory, 0o755)
  await chmod(paths[1]!, 0o644)
  await rm(paths[2]!)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("not-an-app-id-for-tests")
    .mockImplementationOnce(async (_label, initial) => {
      expect(initial).toBe("not-an-app-id-for-tests")
      return "123"
    })
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  let correction = 0
  vi.mocked(test.ui.select).mockImplementation(async (message, options) => {
    if (/GitHub App ID/.test(message)) return choose(options, /edit/i)
    expect(test.uploads).toEqual([])
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringMatching(/recheck/i) }),
        expect.objectContaining({ label: expect.stringMatching(/edit/i) }),
        expect.objectContaining({ label: expect.stringMatching(/exit/i) }),
      ]),
    )
    const notices = JSON.stringify(vi.mocked(test.ui.notice!).mock.calls)
    if (correction === 0) {
      expect((await stat(paths[1]!)).mode & 0o777).toBe(0o644)
      expect(notices).toMatch(/0644|644/)
      expect(notices).toMatch(/chmod (?:0?600)/)
      expect(notices).toContain(`'${paths[1]}'`)
      await chmod(paths[1]!, 0o600)
    } else if (correction === 1) {
      expect((await stat(keyDirectory)).mode & 0o777).toBe(0o755)
      expect(notices).toMatch(/chmod (?:0?700)/)
      expect(notices).toContain(`'${keyDirectory}'`)
      await chmod(keyDirectory, 0o700)
    } else if (correction === 2) {
      expect(notices).toMatch(/missing|not exist|not found/i)
      await writeFile(paths[2]!, "too-short", { mode: 0o600 })
    } else if (correction === 3) {
      expect(notices).toMatch(/webhook|20/i)
      await writeFile(paths[2]!, values[2]!)
    } else {
      throw new Error("Unexpected repeated correction")
    }
    correction++
    return choose(options, /recheck/i)
  })

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(correction).toBe(4)
  expect(test.ui.text).toHaveBeenCalledTimes(8)
  expect(desired.github_app_id).toBe("123")
  expect(test.uploads).toHaveLength(3)
  const visible = JSON.stringify([
    await progressContents(test.context.directory),
    vi.mocked(test.ui.notice!).mock.calls,
    vi.mocked(test.ui.status).mock.calls,
    test.run.mock.calls,
  ])
  expect(visible).not.toContain("not-an-app-id-for-tests")
  expectNoCredentials(visible, [...values, "too-short", Buffer.from(values[1]!).toString("base64")])
})

it("prefills an invalid file path for editing while retaining earlier answers", async () => {
  const test = await scenario()
  const { paths } = await githubCredentials(test)
  const missing = join(test.context.directory, "missing client secret")
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(missing)
    .mockImplementationOnce(async (_label, initial) => {
      expect(initial).toBe(missing)
      return paths[0]!
    })
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /edit/i),
  )

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledTimes(8)
  expect(desired.github_client_id).toBe("Iv23synthetic")
  expect(test.uploads).toHaveLength(3)
  expect(JSON.stringify(await progressContents(test.context.directory))).not.toContain(missing)
})

it("offers correction for a symlink without changing the link or uploading earlier credentials", async () => {
  const test = await scenario()
  const { paths } = await githubCredentials(test)
  const redirect = join(test.context.directory, "redirected client")
  await symlink(paths[0]!, redirect)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(redirect)
    .mockImplementationOnce(async (_label, initial) => {
      expect(initial).toBe(redirect)
      return paths[0]!
    })
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) => {
    expect((await lstat(redirect)).isSymbolicLink()).toBe(true)
    expect(test.uploads).toEqual([])
    return choose(options, /edit/i)
  })

  await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(test.ui.select).toHaveBeenCalledOnce()
  expect((await lstat(redirect)).isSymbolicLink()).toBe(true)
  expect(test.uploads).toHaveLength(3)
})

it("resumes validated public answers after cancellation but rereads and rechecks the saved credential file", async () => {
  const test = await scenario()
  const { paths, values } = await githubCredentials(test)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("invalid-app-id-not-to-save")
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockRejectedValueOnce(new DOMException("Synthetic cancellation", "AbortError"))
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /edit/i),
  )

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(test.uploads).toEqual([])
  const saved = JSON.stringify(await progressContents(test.context.directory))
  expect(saved).toContain("123")
  expect(saved).toContain("Iv23synthetic")
  expect(saved).toContain("456")
  expect(saved).toContain(paths[0]!)
  expect(saved).not.toContain("invalid-app-id-not-to-save")
  expectNoCredentials(saved, values)
  await chmod(paths[0]!, 0o644)
  const corrected = "synthetic-replaced-client-secret"
  vi.mocked(test.ui.text)
    .mockReset()
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  let resumed = false
  let rechecked = false
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) => {
    if (!resumed) {
      resumed = true
      return choose(options, /resume/i)
    }
    expect(test.uploads).toEqual([])
    expect((await stat(paths[0]!)).mode & 0o777).toBe(0o644)
    await writeFile(paths[0]!, corrected)
    await chmod(paths[0]!, 0o600)
    rechecked = true
    return choose(options, /recheck/i)
  })

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(resumed).toBe(true)
  expect(rechecked).toBe(true)
  expect(test.ui.text).toHaveBeenCalledTimes(3)
  expect(desired.github_app_id).toBe("123")
  expect(desired.github_client_id).toBe("Iv23synthetic")
  expect(desired.github_app_installation_id).toBe("456")
  expect(test.uploads[0]!.value).toBe(corrected)
  const visible = JSON.stringify([
    await progressContents(test.context.directory),
    vi.mocked(test.ui.notice!).mock.calls,
    vi.mocked(test.ui.status).mock.calls,
  ])
  expectNoCredentials(visible, [...values, corrected])
})

it("saves accepted IDs when exiting an invalid ID prompt and resumes at that unresolved answer", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  const invalid = "invalid-installation-id-never-to-save"
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce(invalid)
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /exit/i),
  )

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(Error)

  const saved = JSON.stringify(await progressContents(test.context.directory))
  expect(saved).toContain("123")
  expect(saved).toContain("Iv23synthetic")
  expect(saved).not.toContain(invalid)
  expect(test.uploads).toEqual([])
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /resume/i),
  )
  vi.mocked(test.ui.text)
    .mockReset()
    .mockImplementationOnce(async (label, initial) => {
      expect(label).toMatch(/installation ID/i)
      expect(initial).not.toBe(invalid)
      return "456"
    })
    .mockRejectedValueOnce(new DOMException("Synthetic credential cancellation", "AbortError"))

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(test.ui.text).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(await progressContents(test.context.directory))).toContain("456")
  expect(test.uploads).toEqual([])
})

it("requires confirmation before starting over and keeps saved answers when confirmation is declined", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockRejectedValueOnce(new DOMException("Synthetic cancellation", "AbortError"))
  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toMatchObject({ name: "AbortError" })
  const saved = await progressContents(test.context.directory)
  vi.mocked(test.ui.text).mockReset()
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /start over/i),
  )
  vi.mocked(test.ui.confirm).mockResolvedValueOnce(false)

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(Error)

  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).not.toHaveBeenCalled()
  expect(await progressContents(test.context.directory)).toEqual(saved)
  expect(test.uploads).toEqual([])
  vi.mocked(test.ui.confirm).mockResolvedValueOnce(true)
  vi.mocked(test.ui.text).mockImplementationOnce(async (label, initial) => {
    expect(label).toBe("GitHub App ID")
    expect(initial).toBe("")
    throw new DOMException("Synthetic cancellation", "AbortError")
  })

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(JSON.stringify(await progressContents(test.context.directory))).not.toContain("123")
  expect(test.uploads).toEqual([])
})

it("resumes successful uploads after save-and-exit and requires an explicit retry for an ambiguous write", async () => {
  const test = await scenario()
  const { paths, values } = await githubCredentials(test)
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  const execute = test.run.getMockImplementation()!
  let failed = false
  let explicitRetry = false
  const failedName = "github-app-private-key"
  const readsAfterFailure: string[][] = []
  test.run.mockImplementation(async (executable, args, options) => {
    if (failed && args[2] !== "set") readsAfterFailure.push(args)
    if (args[2] === "set" && args[args.indexOf("--name") + 1] === failedName) {
      if (!failed) {
        failed = true
        throw new CommandExecutionError(`Synthetic private output: ${values[1]}`, false, 1)
      }
      expect(explicitRetry).toBe(true)
    }
    if (args[2] === "show" && args[args.indexOf("--id") + 1]?.includes(`/${failedName}`))
      throw new CommandExecutionError("SecretNotFound", false, 3)
    return execute(executable, args, options)
  })
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) => {
    expect(failed).toBe(true)
    expect(test.uploads.map(({ name }) => name)).toEqual(["github-client-secret"])
    const saved = JSON.stringify(await progressContents(test.context.directory))
    expect(saved).toContain(test.reference("github-client-secret").secret_id)
    expectNoCredentials(saved, [...values, Buffer.from(values[1]!).toString("base64")])
    return choose(options, /exit/i)
  })

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(Error)

  expect(test.inputs).toEqual(original)
  await rm(paths[0]!)
  readsAfterFailure.splice(0)
  vi.mocked(test.ui.text).mockReset()
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) => {
    if (options.some((option) => /resume/i.test(option.label))) return choose(options, /resume/i)
    expect(test.uploads.map(({ name }) => name)).toEqual(["github-client-secret"])
    expect(
      readsAfterFailure.some(
        (args) => args[2] === "list" || args.some((arg) => arg.includes(`/${failedName}`)),
      ),
    ).toBe(true)
    explicitRetry = true
    return choose(options, /retry|store.*version/i)
  })

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(explicitRetry).toBe(true)
  expect(test.ui.text).not.toHaveBeenCalled()
  expect(test.uploads.map(({ name }) => name)).toEqual([
    "github-client-secret",
    "github-app-private-key",
    "github-webhook-secret",
  ])
  expect(desired.runtime_secret_references!.GITHUB_CLIENT_SECRET).toEqual(
    test.reference("github-client-secret"),
  )
  expect(test.inputs).toEqual(original)
  const visible = JSON.stringify([
    await progressContents(test.context.directory),
    vi.mocked(test.ui.notice!).mock.calls,
    vi.mocked(test.ui.status).mock.calls,
  ])
  expectNoCredentials(visible, [...values, Buffer.from(values[1]!).toString("base64")])
})

it("reconciles a successful remote upload after its response fails without storing another version", async () => {
  const test = await scenario()
  const { paths, values } = await githubCredentials(test)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  const execute = test.run.getMockImplementation()!
  let responseLost = false
  let matchingRead = false
  test.run.mockImplementation(async (executable, args, options) => {
    if (responseLost && args[2] === "show") {
      const id = args[args.indexOf("--id") + 1]!
      if (id.endsWith("/github-client-secret")) matchingRead = true
    }
    if (responseLost && args[2] === "set") {
      expect(matchingRead).toBe(true)
      const saved = JSON.parse((await progressContents(test.context.directory))[0]!) as {
        references: Record<string, unknown>
      }
      expect(saved.references.GITHUB_CLIENT_SECRET).toEqual(test.reference("github-client-secret"))
    }
    const result = await execute(executable, args, options)
    if (!responseLost && args[2] === "set") {
      responseLost = true
      throw new CommandExecutionError(`Synthetic lost response: ${values[0]}`, false, 1)
    }
    return result
  })

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(matchingRead).toBe(true)
  expect(test.ui.select).not.toHaveBeenCalled()
  expect(test.uploads.map(({ name }) => name)).toEqual([
    "github-client-secret",
    "github-app-private-key",
    "github-webhook-secret",
  ])
  expect(desired.runtime_secret_references!.GITHUB_CLIENT_SECRET).toEqual(
    test.reference("github-client-secret"),
  )
  expectNoCredentials(
    JSON.stringify([
      await progressContents(test.context.directory),
      vi.mocked(test.ui.notice!).mock.calls,
      vi.mocked(test.ui.status).mock.calls,
    ]),
    values,
  )
})

it("honors save-and-exit once when a secret write succeeded but its outcome cannot be read", async () => {
  const test = await scenario()
  const { paths, values } = await githubCredentials(test)
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  const execute = test.run.getMockImplementation()!
  let written = false
  test.run.mockImplementation(async (executable, args, options) => {
    if (written && args[2] === "show")
      throw new CommandExecutionError("Synthetic read denied", false, 1)
    const result = await execute(executable, args, options)
    if (args[2] === "set") {
      written = true
      throw new CommandExecutionError("Synthetic lost write response", false, 1)
    }
    return result
  })
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /exit/i),
  )

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toMatchObject({ name: "AbortError" })

  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(test.uploads).toHaveLength(1)
  const saved = JSON.stringify(await progressContents(test.context.directory))
  expect(saved).toContain("GITHUB_CLIENT_SECRET")
  expectNoCredentials(saved, values)
})

it("does not display credential content from malformed Key Vault metadata during recovery", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  const secret = "synthetic-secret-in-malformed-json"
  test.run.mockResolvedValueOnce(`{"value":"${secret}`)

  const failure: unknown = await configurePostSetup(
    test.context,
    "github",
    test.inputs,
    test.deployment,
  ).catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(Error)
  expect(String(failure)).toMatch(/invalid secret metadata/i)
  expectNoCredentials(
    JSON.stringify([
      String(failure),
      vi.mocked(test.ui.notice!).mock.calls,
      vi.mocked(test.ui.status).mock.calls,
    ]),
    [secret],
  )
  expect(test.ui.text).not.toHaveBeenCalled()
  expect(test.uploads).toEqual([])
})

it("keeps all existing GitHub references and the verified provider revision when credential files are blank", async () => {
  const test = await scenario()
  test.provider.revision = 4
  Object.assign(test.inputs, {
    hub_application_origin: test.deployment.origin,
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
  test.secrets.set("github-client-secret", "synthetic-client-secret")
  test.secrets.set(
    "github-app-private-key",
    Buffer.from(
      generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    ).toString("base64"),
  )
  test.secrets.set("github-webhook-secret", "synthetic-webhook-secret-for-tests-only")
  test.deployment.environment = {
    GITHUB_APP_ID: "123",
    GITHUB_CLIENT_ID: "Iv23synthetic",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_PROVIDER_REVISION: "4",
    AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(
      Object.fromEntries(
        Object.entries(test.inputs.runtime_secret_references!).map(([key, value]) => [
          key,
          value.secret_id,
        ]),
      ),
    ),
  }
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  expect(await configurePostSetup(test.context, "github", test.inputs, test.deployment)).toEqual(
    test.inputs,
  )

  expect(test.uploads).toEqual([])
  expect(await otherFiles(test.context.directory)).toEqual([])
})

it("preserves inputs and secrets when Copilot installation reconfirmation is declined", async () => {
  const test = await scenario()
  await configuredGithub(test)
  Object.assign(test.inputs.runtime_environment_variables!, {
    REPLICA_COPILOT_AUTHENTICATION: "github-app-installation",
    REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "789",
    REPLICA_COPILOT_GITHUB_ORGANIZATION: "sample-team",
  })
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
    label === "GitHub App ID" ? "999" : (initial ?? ""),
  )
  vi.mocked(test.ui.confirm).mockResolvedValue(false)

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(PostSetupExit)

  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.confirm).toHaveBeenCalledWith(
    expect.stringMatching(/Copilot.*installation.*GitHub App 999/i),
  )
  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
})

it.each(["environment", "secret reference"] as const)(
  "keeps the separate Copilot installation and references after fresh approval with its mode stored through %s",
  async (source) => {
    const test = await scenario()
    await configuredGithub(test)
    test.inputs.runtime_environment_variables!.REPLICA_COPILOT_GITHUB_ORGANIZATION = "sample-team"
    test.inputs.runtime_secret_references!.REPLICA_COPILOT_GITHUB_INSTALLATION_ID =
      test.reference("copilot-installation")
    test.secrets.set("copilot-installation", "789")
    if (source === "environment")
      test.inputs.runtime_environment_variables!.REPLICA_COPILOT_AUTHENTICATION =
        "github-app-installation"
    else {
      test.inputs.runtime_secret_references!.REPLICA_COPILOT_AUTHENTICATION =
        test.reference("copilot-mode")
      test.secrets.set("copilot-mode", "github-app-installation")
    }
    const original = structuredClone(test.inputs)
    vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
      label === "GitHub App ID" ? "999" : (initial ?? ""),
    )
    vi.mocked(test.ui.confirm).mockResolvedValue(true)

    const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

    expect(desired.github_app_id).toBe("999")
    expect(desired.github_app_installation_id).toBe("456")
    expect(desired.runtime_environment_variables).toEqual(original.runtime_environment_variables)
    expect(desired.runtime_secret_references).toEqual(original.runtime_secret_references)
    vi.mocked(test.ui.confirm).mockResolvedValue(false)

    await expect(
      configurePostSetup(test.context, "github", test.inputs, test.deployment),
    ).rejects.toBeInstanceOf(PostSetupExit)
    expect(test.ui.confirm).toHaveBeenCalledTimes(2)
    expect(test.inputs).toEqual(original)
    expect(test.uploads).toEqual([])
  },
)

it.each([
  { appId: "123", mode: "github-app-installation" },
  { appId: "999", mode: "environment-token" },
  { appId: "999", mode: "ambient-cli" },
])("preserves Copilot mode $mode without reconfirmation for App $appId", async ({ appId, mode }) => {
  const test = await scenario()
  await configuredGithub(test)
  test.inputs.runtime_environment_variables!.REPLICA_COPILOT_AUTHENTICATION = mode
  if (mode === "github-app-installation") {
    Object.assign(test.inputs.runtime_environment_variables!, {
      REPLICA_COPILOT_GITHUB_INSTALLATION_ID: "789",
      REPLICA_COPILOT_GITHUB_ORGANIZATION: "sample-team",
    })
  } else if (mode === "environment-token")
    test.inputs.runtime_secret_references!.REPLICA_COPILOT_TOKEN = test.reference("copilot-token")
  const original = structuredClone(test.inputs)
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
    label === "GitHub App ID" ? appId : (initial ?? ""),
  )

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(test.ui.confirm).not.toHaveBeenCalled()
  expect(desired.runtime_environment_variables).toEqual(original.runtime_environment_variables)
  expect(desired.runtime_secret_references).toEqual(original.runtime_secret_references)
  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
})

it("pins the exact version read for a kept unversioned GitHub credential", async () => {
  const test = await scenario()
  await configuredGithub(test)
  const key = "GITHUB_CLIENT_SECRET"
  const pinned = test.reference("github-client-secret", "b".repeat(32))
  const unversioned = {
    ...pinned,
    secret_id: pinned.secret_id.replace(/\/[a-f0-9]{32}$/, ""),
  }
  test.inputs.runtime_secret_references![key] = unversioned
  const original = structuredClone(test.inputs)
  const liveReferences = JSON.parse(test.deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
  liveReferences[key] = unversioned.secret_id
  test.deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
  returnSecretId(test, unversioned.secret_id, pinned.secret_id)
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(desired.runtime_secret_references![key]).toEqual(pinned)
  expect(desired.github_provider_revision).toBe(5)
  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
})

it("rejects a kept GitHub credential when Key Vault returns a different secret", async () => {
  const test = await scenario()
  await configuredGithub(test)
  const key = "GITHUB_CLIENT_SECRET"
  const requested = test.inputs.runtime_secret_references![key]!
  const original = structuredClone(test.inputs)
  returnSecretId(test, requested.secret_id, test.reference("another-secret").secret_id)
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toThrow()

  expect(test.inputs).toEqual(original)
  expect(test.uploads).toEqual([])
})

it.each([
  { deployedAppId: "123", answer: "4", accepted: true },
  { deployedAppId: "123", answer: "5", accepted: true },
  { deployedAppId: "123", answer: "6", accepted: false },
  { deployedAppId: "123", answer: "3", accepted: false },
  { deployedAppId: "999", answer: "5", accepted: true },
  { deployedAppId: "999", answer: "4", accepted: false },
  { deployedAppId: "999", answer: "6", accepted: false },
])(
  "accepts provider revision $answer for deployed App $deployedAppId only when Hub would start: $accepted",
  async ({ deployedAppId, answer, accepted }) => {
    const test = await scenario()
    test.provider.revision = 4
    Object.assign(test.inputs, {
      hub_application_origin: test.deployment.origin,
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
    test.secrets.set("github-client-secret", "synthetic-client-secret")
    test.secrets.set(
      "github-app-private-key",
      Buffer.from(
        generateKeyPairSync("rsa", { modulusLength: 2048 })
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      ).toString("base64"),
    )
    test.secrets.set("github-webhook-secret", "synthetic-webhook-secret-for-tests-only")
    test.deployment.environment = {
      GITHUB_APP_ID: deployedAppId,
      GITHUB_CLIENT_ID: "Iv23synthetic",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_PROVIDER_REVISION: "4",
      AZURE_KEY_VAULT_SECRET_REFERENCES: JSON.stringify(
        Object.fromEntries(
          Object.entries(test.inputs.runtime_secret_references!).map(([key, value]) => [
            key,
            value.secret_id,
          ]),
        ),
      ),
    }
    const correction = deployedAppId === "123" ? "4" : "5"
    const answers = [answer, correction]
    vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
      label.startsWith("GitHub provider revision") ? answers.shift()! : (initial ?? ""),
    )

    const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

    const revisionPrompts = vi
      .mocked(test.ui.text)
      .mock.calls.filter(([label]) => label.startsWith("GitHub provider revision"))
    expect(revisionPrompts).toHaveLength(accepted ? 1 : 2)
    expect(desired.github_provider_revision).toBe(Number(accepted ? answer : correction))
  },
)

it("advances a disabled database provider from revision 4 to revision 5", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.provider.enabled = false
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(desired.github_provider_revision).toBe(5)
  expect(test.provider.confirmations).toBe(1)
  expect(test.provider.verifications).toBe(1)
  expect(test.provider.enabledChecks).toBe(1)
  // Hub's canonical public configuration for this synthetic installation.
  expect(test.provider.enabledPrompt).toContain(
    "d29ed252f783d0078daf7eafba693a86dfb9b8abd09f37d23e907a8226c375ea",
  )
  expect(test.uploads).toEqual([])
})

it("uses database revision 0 despite an unreconciled deployed revision 4, and verifies again on resume", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.provider.revision = 0
  let answer = "1"
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
    label.startsWith("GitHub provider revision") ? answer : (initial ?? ""),
  )

  const first = await configurePostSetup(test.context, "github", test.inputs, test.deployment)
  expect(first.github_provider_revision).toBe(1)
  expect(test.provider.enabledChecks).toBe(0)

  test.provider.revision = 4
  test.provider.enabled = false
  answer = "5"
  const resumed = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(resumed.github_provider_revision).toBe(5)
  expect(test.provider.confirmations).toBe(2)
  expect(test.provider.verifications).toBe(2)
  expect(test.provider.enabledChecks).toBe(1)
  expect(test.uploads).toEqual([])
})

it("does not write a replacement credential when the database revision was not independently verified", async () => {
  const test = await scenario()
  const { paths } = await configuredGithub(test)
  test.provider.confirmed = false
  await writeFile(paths[0]!, "synthetic-new-client-secret")
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
    label.startsWith("Client secret:") ? paths[0]! : (initial ?? ""),
  )

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toThrow(/verif.*revision/i)

  expect(test.provider.confirmations).toBe(1)
  expect(test.provider.verifications).toBe(0)
  expect(test.uploads).toEqual([])
})

it("retains a pending desired provider revision ahead of the database even when the deployed references now match", async () => {
  const test = await scenario()
  await configuredGithub(test)
  test.inputs.github_provider_revision = 5
  test.deployment.environment.GITHUB_PROVIDER_REVISION = "5"
  vi.mocked(test.ui.text).mockImplementation(async (_label, initial) => initial ?? "")

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(desired.github_provider_revision).toBe(5)
  expect(test.provider.verifications).toBe(1)
  expect(test.uploads).toEqual([])
})

it.each(["saved desired inputs", "retained progress after starting over"] as const)(
  "requires the next provider revision when %s contains a newer credential version than the live deployment",
  async (source) => {
    const test = await scenario()
    await configuredGithub(test)
    const replacement = test.reference("github-client-secret", "b".repeat(32))
    if (source === "saved desired inputs") {
      test.inputs.runtime_secret_references!.GITHUB_CLIENT_SECRET = replacement
    } else {
      const progress = await postSetupProgress(test.context, "github", test.inputs)
      await progress.saveReference("GITHUB_CLIENT_SECRET", replacement)
      vi.mocked(test.ui.confirm).mockResolvedValue(true)
      vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
        options.some((option) => /start over/i.test(option.label))
          ? choose(options, /start over/i)
          : choose(options, /edit/i),
      )
    }
    const answers = ["4", "5"]
    vi.mocked(test.ui.text).mockImplementation(async (label, initial) =>
      label.startsWith("GitHub provider revision") ? answers.shift()! : (initial ?? ""),
    )

    const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

    expect(desired.github_provider_revision).toBe(5)
    expect(desired.runtime_secret_references!.GITHUB_CLIENT_SECRET).toEqual(replacement)
    expect(test.uploads).toEqual([])
  },
)

it("replaces a credential as a new version of its existing nondefault vault secret", async () => {
  const test = await scenario()
  const { paths } = await configuredGithub(test)
  const previous = test.reference("existing-oauth-client")
  test.inputs.runtime_secret_references!.GITHUB_CLIENT_SECRET = previous
  const liveReferences = JSON.parse(test.deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
  liveReferences.GITHUB_CLIENT_SECRET = previous.secret_id
  test.deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
  test.secrets.set("existing-oauth-client", "synthetic-old-client-secret")
  test.secrets.delete("github-client-secret")
  await writeFile(paths[0]!, "synthetic-new-client-secret")
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    const result = await execute(executable, args, options)
    return args[2] === "set"
      ? JSON.stringify(test.reference(args[args.indexOf("--name") + 1]!, "b".repeat(32)).secret_id)
      : result
  })
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) => {
    if (label.startsWith("Client secret:")) return paths[0]!
    if (label.startsWith("GitHub provider revision")) return "5"
    return initial ?? ""
  })

  const desired = await configurePostSetup(test.context, "github", test.inputs, test.deployment)

  expect(test.uploads.map(({ name }) => name)).toEqual(["existing-oauth-client"])
  expect(desired.runtime_secret_references!.GITHUB_CLIENT_SECRET).toEqual(
    test.reference("existing-oauth-client", "b".repeat(32)),
  )
  expect(test.secrets.has("github-client-secret")).toBe(false)
  expect(desired.github_provider_revision).toBe(5)
})

it.each(["foreign vault", "unsupported URI"] as const)(
  "refuses to replace a credential with a %s reference before writing any secret",
  async (kind) => {
    const test = await scenario()
    const { paths } = await configuredGithub(test)
    const existing = test.reference("github-client-secret")
    if (kind === "foreign vault") {
      existing.key_vault_id = existing.key_vault_id.replace(/vaults\/[^/]+$/, "vaults/other-vault")
      existing.secret_id = existing.secret_id.replace(
        new URL(existing.secret_id).hostname,
        "other-vault.vault.azure.net",
      )
    } else {
      existing.secret_id = existing.secret_id.replace(
        new URL(existing.secret_id).hostname,
        "unsupported.example.com",
      )
    }
    test.inputs.runtime_secret_references!.GITHUB_CLIENT_SECRET = existing
    const liveReferences = JSON.parse(test.deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES!)
    liveReferences.GITHUB_CLIENT_SECRET = existing.secret_id
    test.deployment.environment.AZURE_KEY_VAULT_SECRET_REFERENCES = JSON.stringify(liveReferences)
    const before = structuredClone(test.inputs)
    vi.mocked(test.ui.text).mockImplementation(async (label, initial) => {
      if (label.startsWith("Client secret:")) return paths[0]!
      if (label.startsWith("GitHub provider revision")) return "5"
      return initial ?? ""
    })

    await expect(
      configurePostSetup(test.context, "github", test.inputs, test.deployment),
    ).rejects.toThrow(/vault|secret|reference/i)

    expect(test.inputs).toEqual(before)
    expect(test.uploads).toEqual([])
  },
)

it("does not replace another credential after starting over with an unresolved RSA upload", async () => {
  const test = await scenario()
  const { paths } = await configuredGithub(test)
  await writeFile(paths[0]!, "synthetic-new-client-secret")
  const progress = await postSetupProgress(test.context, "github", test.inputs)
  await progress.pendingUpload("GITHUB_APP_PRIVATE_KEY_BASE64")
  const originalSecrets = new Map(test.secrets)
  vi.mocked(test.ui.confirm).mockResolvedValue(true)
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    options.some((option) => /start over/i.test(option.label))
      ? choose(options, /start over/i)
      : choose(options, /exit/i),
  )
  vi.mocked(test.ui.text).mockImplementation(async (label, initial) => {
    if (label.startsWith("Client secret:")) return paths[0]!
    if (label.startsWith("GitHub provider revision")) return "5"
    return initial ?? ""
  })

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toThrow(/earlier.*GITHUB_APP_PRIVATE_KEY_BASE64.*unknown outcome/i)

  expect(test.uploads).toEqual([])
  expect(test.secrets).toEqual(originalSecrets)
  expect((await postSetupProgress(test.context, "github", test.inputs)).pending).toBe(
    "GITHUB_APP_PRIVATE_KEY_BASE64",
  )
})

it("rejects a non-RSA credential before uploading any supplied GitHub secret", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  const client = join(test.context.directory, "client")
  const key = join(test.context.directory, "key")
  await writeFile(client, "synthetic-client-secret", { mode: 0o600 })
  await writeFile(
    key,
    generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString(),
    { mode: 0o600 },
  )
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(client)
    .mockResolvedValueOnce(key)
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /exit/i),
  )

  await expect(
    configurePostSetup(test.context, "github", test.inputs, test.deployment),
  ).rejects.toBeInstanceOf(Error)

  expect(test.uploads).toEqual([])
  expect(test.run.mock.calls.every(([, args]) => args[2] === "show")).toBe(true)
})

it("keeps credential command failures private and removes the upload file without changing supplied inputs", async () => {
  const test = await scenario()
  test.inputs.hub_application_origin = test.deployment.origin
  const original = structuredClone(test.inputs)
  const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
  const secrets = ["synthetic-client-secret", pem, "synthetic-webhook-secret-for-tests-only"]
  const paths = secrets.map((_, index) => join(test.context.directory, `credential-${index}`))
  await Promise.all(paths.map((path, index) => writeFile(path, secrets[index]!, { mode: 0o600 })))
  vi.mocked(test.ui.text)
    .mockResolvedValueOnce("123")
    .mockResolvedValueOnce("Iv23synthetic")
    .mockResolvedValueOnce("456")
    .mockResolvedValueOnce(paths[0]!)
    .mockResolvedValueOnce(paths[1]!)
    .mockResolvedValueOnce(paths[2]!)
    .mockResolvedValueOnce("1")
  const execute = test.run.getMockImplementation()!
  vi.mocked(test.ui.select).mockImplementation(async (_message, options) =>
    choose(options, /exit/i),
  )
  let upload: string | undefined
  test.run.mockImplementation(async (executable, args, options) => {
    if (args.slice(0, 3).join(" ") === "keyvault secret set") {
      upload = args[args.indexOf("--file") + 1]!
      expect((await stat(upload)).mode & 0o777).toBe(0o600)
      throw new CommandExecutionError(`Synthetic tool output: ${secrets.join("\n")}`, false, 1)
    }
    return execute(executable, args, options)
  })

  const failure: unknown = await configurePostSetup(
    test.context,
    "github",
    test.inputs,
    test.deployment,
  ).catch((error: unknown) => error)

  expect(failure).toBeInstanceOf(Error)
  expect(test.inputs).toEqual(original)
  expect(upload).toBeDefined()
  await expect(stat(upload!)).rejects.toMatchObject({ code: "ENOENT" })
  const visible = JSON.stringify([
    String(failure),
    failure instanceof CommandExecutionError ? failure.details() : "",
    vi.mocked(test.ui.status).mock.calls,
    vi.mocked(test.ui.notice!).mock.calls,
  ])
  expectNoCredentials(visible, secrets)
})
