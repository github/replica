import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../installer/command/index.ts"
import type {
  DeploymentConfig,
  RemovalTarget,
  RunCommand,
  WizardUI,
} from "../../installer/types.ts"
import { installationWorkspace } from "../../installer/workspace/index.ts"
import { installationNames } from "../install/settings.ts"
import { inspectRemoval } from "./inspect/index.ts"
import { RemovalLeaseError } from "./lease-error/index.ts"
import { prepareRemovalModule } from "./prepare-module/index.ts"
import type { RemovalContext, RemovalModule, RemovalResource } from "./types.ts"
import { removeAzureDeployments } from "./index.ts"

vi.mock("./prepare-module/index.ts", () => ({ prepareRemovalModule: vi.fn() }))

const directories: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function scenario(count = 1) {
  const root = resolve(`.removal-batch-test-${randomUUID()}`)
  directories.push(root)
  await mkdir(root, { mode: 0o700 })
  const events: string[] = []
  const deployments = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const config: DeploymentConfig = {
        version: 1,
        cloud: "azure",
        name: `sample-${index}-hub`,
        owner: "sample-team",
        azure: {
          subscriptionId: "00000000-0000-0000-0000-000000000001",
          tenantId: "00000000-0000-0000-0000-000000000002",
          location: "eastus2",
          resourceGroup: `sample-${index}-hub-rg`,
        },
      }
      const target: RemovalTarget = { path: join(root, `${config.name}.json`), config }
      const directory = installationWorkspace(config, root)
      await mkdir(directory, { mode: 0o700 })
      const saved = new Map([
        [target.path, JSON.stringify(config)],
        [
          `${target.path}.draft.json`,
          JSON.stringify({
            version: 1,
            id: randomUUID(),
            configPath: target.path,
            createdAt: "2026-11-01T10:00:00.000Z",
            updatedAt: "2026-11-02T10:00:00.000Z",
            phase: "provision",
            deploymentStarted: true,
            answers: { cloud: "azure", name: config.name },
          }),
        ],
        [join(directory, "installation.tfvars.json"), '{"synthetic":"retained input"}'],
        [join(directory, "original.log"), "synthetic retained diagnostics\n"],
      ])
      for (const [path, content] of saved) await writeFile(path, content, { mode: 0o600 })
      const names = installationNames(config)
      const groupId = (group: string) =>
        `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${group}`
      const tags = {
        application: "replica-hub",
        installation: config.name,
        owner: config.owner,
        managed_by: "terraform",
      }
      const resource = (address: string, group: string, path: string): RemovalResource => ({
        address,
        type: address.split(".")[0]!,
        id: `${groupId(group)}/providers/${path}`,
        values: {},
      })
      const resources: Record<RemovalModule, RemovalResource[]> = {
        provision: [
          resource(
            "azurerm_container_app_job.provision",
            config.azure.resourceGroup,
            `Microsoft.App/jobs/${config.name}-provision`,
          ),
        ],
        app: [
          resource(
            "azurerm_container_app.hub[0]",
            config.azure.resourceGroup,
            `Microsoft.App/containerApps/${config.name}-hub`,
          ),
          resource(
            "azurerm_container_app_environment.hub",
            config.azure.resourceGroup,
            `Microsoft.App/managedEnvironments/${config.name}-environment`,
          ),
          resource(
            "azurerm_storage_account.artifacts",
            config.azure.resourceGroup,
            `Microsoft.Storage/storageAccounts/${config.name.replaceAll("-", "")}hub`,
          ),
        ],
        foundation: [
          resource(
            "azurerm_key_vault.hub",
            names.foundationGroup,
            `Microsoft.KeyVault/vaults/${names.vault}`,
          ),
        ],
      }
      resources.app.push({
        ...resource(
          "azurerm_user_assigned_identity.hub",
          config.azure.resourceGroup,
          `Microsoft.ManagedIdentity/userAssignedIdentities/${config.name}-hub`,
        ),
        values: { principal_id: "00000000-0000-0000-0000-000000000003" },
      })
      const live = (resource: RemovalResource) => ({
        id: resource.id,
        type: resource.id.split("/providers/")[1]!.split("/").slice(0, 2).join("/"),
        tags: { ...tags },
      })
      const groups = new Map<string, { id: string; type: string; tags: Record<string, string> }[]>([
        [config.azure.resourceGroup, [...resources.app, ...resources.provision].map(live)],
        [names.foundationGroup, resources.foundation.map(live)],
        [
          names.stateGroup,
          [
            {
              id: `${groupId(names.stateGroup)}/providers/Microsoft.Storage/storageAccounts/${names.stateAccount}`,
              type: "Microsoft.Storage/storageAccounts",
              tags: { ...tags, managed_by: "replica-installer" },
            },
          ],
        ],
      ])
      const unlocked = () => ({
        status: "unlocked",
        state: "available",
        duration: null as string | null,
      })
      const blobs = [
        "provision.tfstate",
        "app.tfstate",
        "foundation.tfstate",
        "installer.lock",
      ].map((name) => ({ name: `${config.name}/${name}`, lease: unlocked() }))
      return {
        target,
        directory,
        saved,
        names,
        groupId,
        tags,
        groups,
        resources,
        blobs,
        currentLeases: new Map<string, unknown>(),
        stateMetadata: new Map<string, {
          lock?: string
          etag: string
          modified: string
          size: number
        }>(),
        unlockError: undefined as CommandExecutionError | undefined,
        installationLease: "synthetic-installation-lease",
        releaseLease: unlocked(),
        releaseExists: true,
        hubActive: true,
        executions: [{ name: "terminal-job", status: "Succeeded" }] as unknown,
        jobs: [{ name: `${config.name}-custom-job` }] as unknown,
        sharedWorkloads: [] as { id: string; environment?: string }[],
        externalGrants: [] as unknown[],
        containers: ["terraform"] as unknown,
        livePrincipal: "00000000-0000-0000-0000-000000000003",
        badOwner: false,
        wrongTenant: false,
        failDestroy: undefined as RemovalModule | undefined,
        destroyError: undefined as Error | undefined,
        afterVerify: undefined as (() => Promise<void>) | undefined,
      }
    }),
  )
  const targets = deployments.map(({ target }) => target)
  const ui: WizardUI = {
    cloud: vi.fn(),
    select: vi.fn(async () => "exit"),
    multiSelect: vi.fn(),
    removal: vi.fn(),
    text: vi.fn(async () => {
      const target = targets[vi.mocked(ui.text).mock.calls.length - 1]!
      events.push(`typed:${target.config.name}`)
      return target.config.name
    }),
    confirm: vi.fn(async () => {
      events.push("confirmed")
      return true
    }),
    status: vi.fn(),
    wait: vi.fn(),
    notice: vi.fn(),
    complete: vi.fn(),
  }
  function option(args: string[], flag: string) {
    const index = args.indexOf(flag)
    return index < 0 ? undefined : args[index + 1]
  }
  let accountReads = 0
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (executable === "terraform") {
      const source = args[0]?.replace(/^-chdir=/, "")!
      const deployment = deployments.find(({ directory }) => source.startsWith(`${directory}/`))!
      expect(deployment).toBeDefined()
      const kind = basename(source) as RemovalModule
      expect(["provision", "app", "foundation"]).toContain(kind)
      expect(source).toContain(`/recover-${kind}/${kind}`)
      if (args[1] === "init") {
        events.push(`${deployment.target.config.name}:state-init:${kind}`)
        return ""
      }
      if (args[1] === "force-unlock") {
        const name = `${deployment.target.config.name}/${kind}.tfstate`
        const metadata = deployment.stateMetadata.get(name)!
        const info = JSON.parse(Buffer.from(metadata.lock!, "base64").toString("utf8"))
        expect(args.slice(1)).toEqual(["force-unlock", "-force", info.ID])
        events.push(`${deployment.target.config.name}:state-unlock:${kind}`)
        if (deployment.unlockError) throw deployment.unlockError
        Object.assign(deployment.blobs.find((blob) => blob.name === name)!.lease, {
          status: "unlocked", state: "available", duration: null,
        })
        deployment.stateMetadata.delete(name)
        return ""
      }
      throw new Error("Removal recovery must only initialize and force-unlock the selected backend")
    }
    if (executable !== "az")
      throw new Error("Removal orchestration test must not execute a real program")
    const deployment =
      args[0] === "account"
        ? deployments[accountReads++ % deployments.length]!
        : (deployments.find(
            ({ target }) =>
              args.includes(target.config.azure.resourceGroup) ||
              args.includes(installationNames(target.config).stateGroup) ||
              args.includes(installationNames(target.config).foundationGroup) ||
              args.includes(installationNames(target.config).stateAccount) ||
              args.includes(
                `/subscriptions/${target.config.azure.subscriptionId}/resourceGroups/${target.config.azure.resourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${target.config.name}-hub`,
              ) ||
              args.includes(`${target.config.name.replaceAll("-", "")}hub`) ||
              args.includes(`${target.config.name}-environment`),
          ) ?? deployments[0]!)
    const {
      target: { config },
      names,
      groupId,
      groups,
      tags,
    } = deployment
    const operation = args.slice(0, 3).join(" ")
    if (args[0] === "account")
      return JSON.stringify({
        id: config.azure.subscriptionId,
        tenantId: deployment.wrongTenant ? config.azure.subscriptionId : config.azure.tenantId,
      })
    expect(option(args, "--subscription")).toBe(config.azure.subscriptionId)
    if (operation === "group exists --name")
      return JSON.stringify(groups.has(option(args, "--name")!))
    if (operation === "group show --name") {
      const group = option(args, "--name")!
      return JSON.stringify({
        id: groupId(group),
        tags: {
          ...tags,
          managed_by: group === names.stateGroup ? "replica-installer" : "terraform",
          ...(deployment.badOwner && { owner: "another-team" }),
        },
      })
    }
    if (operation === "resource list --resource-group")
      return JSON.stringify(groups.get(option(args, "--resource-group")!) ?? [])
    if (operation === "storage account show") {
      const state = option(args, "--name") === names.stateAccount
      const account = groups
          .get(state ? names.stateGroup : config.azure.resourceGroup)!
          .find(({ type }) => type === "Microsoft.Storage/storageAccounts")!
      return JSON.stringify(option(args, "--query") === "tags" ? account.tags : account)
    }
    if (operation === "storage container list") {
      expect(args).toEqual(expect.arrayContaining(["--num-results", "*", "--include-deleted"]))
      return JSON.stringify(deployment.containers)
    }
    if (operation === "identity show --ids")
      return JSON.stringify({
        id: option(args, "--ids"),
        principalId: deployment.livePrincipal,
      })
    if (operation === "storage blob list") {
      expect(args.slice(0, 3)).toEqual(["storage", "blob", "list"])
      const options = args.slice(3)
      const flags = new Set([
        "--account-name",
        "--container-name",
        "--auth-mode",
        "--num-results",
        "--include",
        "--prefix",
        "--query",
        "--subscription",
        "--output",
      ])
      for (let index = 0; index < options.length; index++) {
        const flag = options[index]!
        if (flag === "--only-show-errors") continue
        expect(flags.has(flag), `Unexpected positional argument or flag: ${flag}`).toBe(true)
        expect(options[++index]).toBeDefined()
      }
      if (args.includes("--prefix")) {
        expect(option(args, "--prefix")).toBe(`${config.name}/`)
        expect(option(args, "--query")).toBe("[].{name:name,lease:properties.lease}")
        return JSON.stringify(
          deployment.blobs
            .filter((blob) => !("current" in blob && blob.current === false) &&
              !("deleted" in blob && blob.deleted === true))
            .map(({ name, lease }) => ({
              name,
              lease: deployment.currentLeases.has(name) ? deployment.currentLeases.get(name) : lease,
            })),
        )
      }
      expect(option(args, "--include")).toBe("dsv")
      expect(args.filter((arg) => arg === "--include")).toHaveLength(1)
      expect(option(args, "--num-results")).toBe("*")
      return JSON.stringify(deployment.blobs)
    }
    if (operation === "storage blob exists")
      return JSON.stringify({ exists: deployment.releaseExists })
    if (operation === "storage blob show") {
      const name = option(args, "--name")!
      if (option(args, "--container-name") === "releases") {
        expect(option(args, "--query")).toBe("properties.lease")
        expect(option(args, "--account-name")).toBe(`${config.name.replaceAll("-", "")}hub`)
        expect(name).toBe("deployment.lock")
        return JSON.stringify(deployment.releaseLease)
      }
      expect(option(args, "--account-name")).toBe(names.stateAccount)
      expect(option(args, "--container-name")).toBe("terraform")
      const blob = deployment.blobs.find((blob) => blob.name === name)
      expect(blob, `Unexpected current blob read: ${name}`).toBeDefined()
      const lease = deployment.currentLeases.has(name)
        ? deployment.currentLeases.get(name) : blob!.lease
      if (option(args, "--query") !== "properties.lease") {
        expect(option(args, "--query")).toBe(
          "{lease:properties.lease,lock:metadata.terraformlockid,etag:properties.etag,modified:properties.lastModified,size:properties.contentLength}",
        )
        expect(option(args, "--auth-mode")).toBe("login")
        return JSON.stringify({
          lease, ...deployment.stateMetadata.get(name),
        })
      }
      return JSON.stringify(
        lease,
      )
    }
    if (operation === "storage blob lease") {
      const release = option(args, "--container-name") === "releases"
      const lease = release
        ? deployment.releaseLease
        : deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease
      events.push(`${config.name}:lease:${args[3]}:${release ? "release" : "installation"}`)
      expect(option(args, "--account-name")).toBe(
        release ? `${config.name.replaceAll("-", "")}hub` : names.stateAccount,
      )
      if (args[3] === "break") {
        expect(option(args, "--blob-name")).toBe(
          release ? "deployment.lock" : `${config.name}/installer.lock`,
        )
        expect(lease).toMatchObject({ status: "locked", state: "leased", duration: "infinite" })
        Object.assign(lease, { status: "unlocked", state: "available", duration: null })
        return "{}"
      }
      if (args[3] === "acquire") {
        if (lease.status !== "unlocked")
          throw new CommandExecutionError("Synthetic lease still belongs to another writer")
        Object.assign(lease, { status: "locked", state: "leased", duration: "infinite" })
        return JSON.stringify(release ? "synthetic-release-lease" : deployment.installationLease)
      }
      if (args[3] === "renew") {
        expect(option(args, "--lease-id")).toBe(
          release ? "synthetic-release-lease" : deployment.installationLease,
        )
        return "{}"
      }
      throw new Error("Removal must not release retained locks")
    }
    if (operation === "storage blob delete") {
      expect(option(args, "--name")).toBe("deployment.lock")
      expect(option(args, "--lease-id")).toBe("synthetic-release-lease")
      deployment.releaseExists = false
      events.push(`${config.name}:delete-release-lock`)
      return "{}"
    }
    if (
      args[0] === "containerapp" &&
      !args.includes("--resource-group") &&
      (args[1] === "list" || operation === "containerapp job list")
    ) {
      const type = args[1] === "list" ? "Microsoft.App/containerApps" : "Microsoft.App/jobs"
      return JSON.stringify(
        deployments.flatMap((item) => [
          ...[...item.groups.values()]
            .flat()
            .filter((value) => value.type === type)
            .map((value) => ({
              id: value.id,
              environment: `${item.groupId(item.target.config.azure.resourceGroup)}/providers/Microsoft.App/managedEnvironments/${item.target.config.name}-environment`,
              images: [],
              initialImages: [],
              registries: [],
              secrets: [],
            })),
          ...item.sharedWorkloads.filter(({ id }) =>
            id.toLowerCase().includes(`/providers/${type.toLowerCase()}/`),
          ),
        ]),
      )
    }
    if (operation === "role assignment list")
      return JSON.stringify(deployments.flatMap(({ externalGrants }) => externalGrants))
    if (operation === "containerapp job list")
      return JSON.stringify(
        option(args, "--query") === "[].name" && Array.isArray(deployment.jobs)
          ? deployment.jobs.map(({ name }) => name)
          : deployment.jobs,
      )
    if (operation === "containerapp job execution") return JSON.stringify(deployment.executions)
    if (args[0] === "containerapp" && args[1] === "list") {
      const apps = groups
          .get(config.azure.resourceGroup)!
          .filter(({ type }) => type === "Microsoft.App/containerApps")
      return JSON.stringify(
        option(args, "--query") === "[].name"
          ? apps.map(({ id }) => id.split("/").at(-1))
          : apps,
      )
    }
    if (args[0] === "containerapp" && args[1] === "show") {
      const app = groups.get(config.azure.resourceGroup)!
        .find(({ type }) => type === "Microsoft.App/containerApps")!
      return JSON.stringify({ ...app, name: `${config.name}-hub` })
    }
    if (operation === "containerapp env show") {
      expect(
        groups
          .get(config.azure.resourceGroup)
          ?.some(({ type }) => type === "Microsoft.App/managedEnvironments"),
      ).toBe(true)
      return JSON.stringify(`ME_${config.name}`)
    }
    if (operation === "containerapp revision list")
      return JSON.stringify([
        option(args, "--query")
          ? { name: "sample-revision", active: deployment.hubActive }
          : { name: "sample-revision", properties: { active: deployment.hubActive } },
      ])
    if (operation === "containerapp revision deactivate") {
      expect(option(args, "--name")).toBe(`${config.name}-hub`)
      deployment.hubActive = false
      events.push(`${config.name}:stop-hub`)
      return "{}"
    }
    if (operation === "containerapp replica list") return "[]"
    if (operation === "storage account delete") {
      events.push(`${config.name}:delete-backend`)
      groups.set(names.stateGroup, [])
      return "{}"
    }
    if (operation === "group delete --name") {
      expect(option(args, "--name")).toBe(names.stateGroup)
      groups.delete(names.stateGroup)
      events.push(`${config.name}:delete-state-group`)
      return "{}"
    }
    throw new Error(`Unexpected synthetic Azure operation: ${args.slice(0, 4).join(" ")}`)
  })
  vi.mocked(prepareRemovalModule).mockImplementation(async (context, kind, staging) => {
    const deployment = deployments.find(({ target }) => target.path === context.target.path)!
    events.push(`${context.config.name}:prepare:${kind}`)
    await writeFile(join(staging, `${kind}.synthetic`), "synthetic staged data", { mode: 0o600 })
    return {
      kind,
      resources: deployment.resources[kind],
      async verifyInputs() {
        await deployment.afterVerify?.()
      },
      async destroy() {
        if (!deployment.resources[kind].length) return
        events.push(`${context.config.name}:destroy:${kind}`)
        if (deployment.failDestroy === kind)
          throw deployment.destroyError ?? new Error("Synthetic destroy failed")
        if (kind === "provision")
          deployment.groups.set(
            context.config.azure.resourceGroup,
            deployment.groups
              .get(context.config.azure.resourceGroup)!
              .filter(({ type }) => type !== "Microsoft.App/jobs"),
          )
        else
          deployment.groups.delete(
            kind === "app" ? context.config.azure.resourceGroup : deployment.names.foundationGroup,
          )
      },
      async empty() {
        events.push(`${context.config.name}:empty:${kind}`)
      },
    }
  })
  return { root, targets, deployments, events, run, ui }
}

async function preserved(test: Awaited<ReturnType<typeof scenario>>) {
  for (const { saved, directory } of test.deployments) {
    for (const [path, content] of saved) expect(await readFile(path, "utf8")).toBe(content)
    expect(
      (await readdir(directory)).some(
        (name) => name.startsWith("removal-") || name.endsWith(".lock"),
      ),
    ).toBe(false)
  }

  expect((await readdir(test.root)).some((name) => name.endsWith(".lock"))).toBe(false)
}

function inspectionContext(test: Awaited<ReturnType<typeof scenario>>, index = 0): RemovalContext {
  const { target, directory } = test.deployments[index]!
  return {
    target,
    config: target.config,
    directory,
    env: {},
    ui: test.ui,
    run: test.run,
    azure: (...args) => test.run("az", [
      ...args,
      "--subscription", target.config.azure.subscriptionId,
      "--only-show-errors", "--output", "json",
    ]),
  }
}

function lockState(
  deployment: Awaited<ReturnType<typeof scenario>>["deployments"][number],
  kind: RemovalModule = "app",
) {
  const name = `${deployment.target.config.name}/${kind}.tfstate`
  const info = {
    ID: "00000000-0000-0000-0000-000000000003",
    Path: `terraform/${name}`,
    Who: "synthetic-private-operator@synthetic-host",
    Operation: "OperationTypeApply",
    Version: "1.13.4",
    Created: "2026-11-10T18:00:00Z",
  }
  Object.assign(deployment.blobs.find((blob) => blob.name === name)!.lease, {
    status: "locked", state: "leased", duration: "infinite",
  })
  const metadata = {
    lock: Buffer.from(JSON.stringify(info)).toString("base64"),
    etag: '"synthetic-current-state"',
    modified: "2026-11-10T18:00:00Z",
    size: 128,
  }
  deployment.stateMetadata.set(name, metadata)
  return { name, info, metadata }
}

it("retains verified managed-group evidence when cleanup outlasts app deletion and rechecks it on retry", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  const managedGroup = `ME_${deployment.target.config.name}`
  deployment.groups.set(managedGroup, [])
  deployment.failDestroy = "foundation"

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(
    "Synthetic destroy failed",
  )
  expect(test.events.some((event) => event.includes("delete-backend"))).toBe(false)
  expect(
    JSON.parse(await readFile(join(deployment.directory, "environment-removal.json"), "utf8")),
  ).toMatchObject({ managedGroup })

  Object.assign(deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
    status: "unlocked",
    state: "available",
    duration: null,
  })
  for (const kind of ["provision", "app"] as const) deployment.resources[kind] = []
  deployment.failDestroy = undefined
  test.run.mockClear()
  vi.mocked(test.ui.text).mockClear()
  deployment.groups.delete(managedGroup)

  await expect(removeAzureDeployments(test.targets, test)).resolves.toContain(
    "owned cloud resources removed",
  )
  expect(
    test.run.mock.calls.some(([, args]) => args.slice(0, 3).join(" ") === "containerapp env show"),
  ).toBe(false)
  expect(
    test.run.mock.calls.some(
      ([, args]) => args[0] === "group" && args[1] === "exists" && args.includes(managedGroup),
    ),
  ).toBe(true)
  await preserved(test)
})

it.each([
  "decline",
  "wrong first name",
  "wrong second name",
  "cancel before consent",
  "cancel during names",
])("starts no command or writer activity after %s", async (gate) => {
  const test = await scenario(2)
  const abort = new AbortController()
  if (gate === "decline") vi.mocked(test.ui.confirm).mockResolvedValue(false)
  if (gate === "wrong first name") vi.mocked(test.ui.text).mockResolvedValue("not-selected")
  if (gate === "wrong second name")
    vi.mocked(test.ui.text)
      .mockResolvedValueOnce(test.targets[0]!.config.name)
      .mockResolvedValueOnce(` ${test.targets[1]!.config.name}`)
  if (gate === "cancel before consent") abort.abort()
  if (gate === "cancel during names")
    vi.mocked(test.ui.text).mockImplementation(async () => {
      abort.abort()
      return test.targets[0]!.config.name
    })

  await expect(
    removeAzureDeployments(test.targets, { ...test, signal: abort.signal }),
  ).rejects.toThrow()

  expect(test.run).not.toHaveBeenCalled()
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  await preserved(test)
})

it("requires interactive distinct deployments rather than accepting deployment approval or duplicate paths", async () => {
  const test = await scenario(2)
  for (const targets of [
    [],
    [test.targets[0]!, test.targets[0]!],
    [test.targets[0]!, { ...test.targets[0]!, path: test.targets[1]!.path }],
    [test.targets[0]!, { ...test.targets[1]!, path: test.targets[0]!.path }],
  ])
    await expect(removeAzureDeployments(targets, test)).rejects.toThrow()
  await expect(
    removeAzureDeployments(test.targets, {
      ...test,
      ui: { ...test.ui, select: undefined } as unknown as WizardUI,
    }),
  ).rejects.toThrow(/interactive/i)
  expect(test.ui.confirm).not.toHaveBeenCalled()
  expect(test.run).not.toHaveBeenCalled()
  await preserved(test)
})

it("rejects overlapping resource-group roles before destructive consent", async () => {
  const test = await scenario()
  const target = test.targets[0]!
  const names = installationNames(target.config)
  for (const resourceGroup of [names.foundationGroup.toUpperCase(), names.stateGroup])
    await expect(
      removeAzureDeployments(
        [
          {
            ...target,
            config: { ...target.config, azure: { ...target.config.azure, resourceGroup } },
          },
        ],
        test,
      ),
    ).rejects.toThrow(/separate.*resource groups/i)
  expect(test.ui.confirm).not.toHaveBeenCalled()
  expect(test.run).not.toHaveBeenCalled()
  await preserved(test)
})

it("obtains one batch review and every exact name, then completely removes each target before preparing or leasing the next", async () => {
  const test = await scenario(2)
  const summary = await removeAzureDeployments(test.targets, test)

  expect(test.ui.confirm).toHaveBeenCalledOnce()
  const review = vi.mocked(test.ui.confirm).mock.calls[0]![0]
  for (const { path, config } of test.targets)
    for (const value of [
      path,
      config.name,
      config.azure.tenantId,
      config.azure.subscriptionId,
      config.azure.location,
    ])
      expect(review).toContain(value)
  for (const warning of [
    /database/i,
    /queue/i,
    /artifact/i,
    /image/i,
    /secret/i,
    /historical state/i,
    /no backups/i,
    /administrative database (?:work|processes)/i,
    /local.*retained/i,
    /partly|partial/i,
    /purge.protected|retention/i,
  ])
    expect(review).toMatch(warning)
  expect(test.events.slice(0, 3)).toEqual([
    "confirmed",
    ...test.targets.map(({ config }) => `typed:${config.name}`),
  ])
  for (const { config } of test.targets) {
    const firstDelete = test.events.indexOf(`${config.name}:destroy:provision`)
    for (const kind of ["provision", "app", "foundation"])
      expect(test.events.indexOf(`${config.name}:prepare:${kind}`)).toBeLessThan(firstDelete)
  }
  const firstFinished = test.events.indexOf(`${test.targets[0]!.config.name}:delete-state-group`)
  for (const event of [
    `${test.targets[1]!.config.name}:lease:acquire:installation`,
    `${test.targets[1]!.config.name}:lease:acquire:release`,
    `${test.targets[1]!.config.name}:prepare:provision`,
  ])
    expect(test.events.indexOf(event)).toBeGreaterThan(firstFinished)
  for (const { config } of test.targets) {
    const operations = test.events.filter(
      (event) =>
        event.startsWith(`${config.name}:`) &&
        !event.includes(":lease:") &&
        !event.includes(":prepare:"),
    )
    expect(operations).toEqual([
      `${config.name}:stop-hub`,
      `${config.name}:destroy:provision`,
      `${config.name}:delete-release-lock`,
      `${config.name}:destroy:app`,
      `${config.name}:destroy:foundation`,
      `${config.name}:empty:provision`,
      `${config.name}:empty:app`,
      `${config.name}:empty:foundation`,
      `${config.name}:delete-backend`,
      `${config.name}:delete-state-group`,
    ])
    expect(summary).toContain(`${config.name}: owned cloud resources removed`)
  }
  expect(test.ui.complete).toHaveBeenCalledOnce()
  expect(test.ui.select).not.toHaveBeenCalled()
  expect(test.ui.wait).not.toHaveBeenCalled()
  expect(
    test.run.mock.calls.some(
      ([, args]) => args.includes("ME_sample-0-hub") && args.includes("delete"),
    ),
  ).toBe(false)
  await preserved(test)
})

it("keeps an exit-code-2 inventory failure read-only until details and an explicit recheck succeed", async () => {
  const test = await scenario(2)
  const failedTarget = test.deployments[1]!
  const failure = new CommandExecutionError(
    "Inspect Terraform state leases failed (exit code 2).",
    false,
    2,
    "Synthetic Azure argument validation details",
  )
  const execute = test.run.getMockImplementation()!
  let failed = false
  test.run.mockImplementation(async (executable, args, options) => {
    if (
      !failed &&
      args.slice(0, 3).join(" ") === "storage blob list" &&
      args.includes(failedTarget.names.stateAccount)
    ) {
      failed = true
      throw failure
    }
    return execute(executable, args, options)
  })
  const choices: ((value: string) => void)[] = []
  vi.mocked(test.ui.select).mockImplementation(
    async () => new Promise<string>((resolve) => choices.push(resolve)),
  )
  const settled = vi.fn()
  const pending = removeAzureDeployments(test.targets, test)
  void pending.then(settled, settled)

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledOnce())
  const commandsAtFailure = test.run.mock.calls.length
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  choices[0]!("details")

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledTimes(2))
  expect(test.ui.wait).toHaveBeenCalledWith(
    expect.stringContaining("Synthetic Azure argument validation details"),
  )
  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(settled).not.toHaveBeenCalled()
  const recheck = vi.mocked(test.ui.select).mock.calls[1]![1].find(({ label }) =>
    /recheck.*read.only/i.test(label),
  )
  expect(recheck).toBeDefined()
  choices[1]!(recheck!.value)

  await expect(pending).resolves.toContain("Removal finished")
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledTimes(test.targets.length)
  expect(test.ui.select).toHaveBeenCalledTimes(2)
  expect(test.ui.notice).toHaveBeenCalledWith(
    expect.stringMatching(/info|success/),
    expect.stringMatching(/continu/i),
  )
  for (const { config } of test.targets)
    expect(test.events).toContain(`${config.name}:delete-state-group`)
  await preserved(test)
})

it("keeps an actual shared-consumer blocker read-only through details before rechecking the same batch", async () => {
  const test = await scenario(2)
  const blocked = test.deployments[1]!
  const foreignId = `${blocked.groupId("unrelated")}/providers/Microsoft.App/containerApps/foreign`
  const environment = `${blocked.groupId(blocked.target.config.azure.resourceGroup)}/providers/Microsoft.App/managedEnvironments/${blocked.target.config.name}-environment`
  blocked.sharedWorkloads.push({ id: foreignId, environment })
  const choices: ((value: string) => void)[] = []
  vi.mocked(test.ui.select).mockImplementation(
    async () => new Promise<string>((resolve) => choices.push(resolve)),
  )
  let returnFromDetails = () => {}
  vi.mocked(test.ui.wait).mockImplementationOnce(async () =>
    new Promise<void>((resolve) => { returnFromDetails = resolve }),
  )
  const settled = vi.fn()
  const pending = removeAzureDeployments(test.targets, test)
  void pending.then(settled, settled)

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledOnce())
  const commandsAtFailure = test.run.mock.calls.length
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  choices[0]!("details")

  await vi.waitFor(() => expect(test.ui.wait).toHaveBeenCalledOnce())
  expect(settled).not.toHaveBeenCalled()
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  returnFromDetails()

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledTimes(2))
  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  blocked.sharedWorkloads = []
  choices[1]!("retry")

  await expect(pending).resolves.toContain("Removal finished")
  for (const [, actions] of vi.mocked(test.ui.select).mock.calls)
    expect(actions.map(({ value }) => value)).toEqual(["retry", "details", "exit"])
  const details = vi.mocked(test.ui.wait).mock.calls[0]![0]
  for (const target of [
    foreignId,
    blocked.target.config.name,
    blocked.target.config.azure.subscriptionId,
    `${blocked.target.config.name}-environment`,
  ])
    expect(details).toContain(target)
  expect(details).toMatch(/move|remove|exclude|keep/i)
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledTimes(test.targets.length)
  for (const { config } of test.targets)
    expect(test.events).toContain(`${config.name}:delete-state-group`)
  await preserved(test)
})

it("keeps a still-shared consumer protected after a read-only recheck without renewing consent", async () => {
  const test = await scenario()
  const blocked = test.deployments[0]!
  const foreignId = `${blocked.groupId("unrelated")}/providers/Microsoft.App/containerApps/foreign`
  blocked.sharedWorkloads.push({
    id: foreignId,
    environment: `${blocked.groupId(blocked.target.config.azure.resourceGroup)}/providers/Microsoft.App/managedEnvironments/${blocked.target.config.name}-environment`,
  })
  vi.mocked(test.ui.select).mockImplementation(async () =>
    vi.mocked(test.ui.select).mock.calls.length === 1 ? "retry" : "exit",
  )

  await expect(removeAzureDeployments(test.targets, test)).rejects.toMatchObject({
    name: "RemovalInspectionError",
    message: expect.stringContaining(foreignId),
  })

  expect(test.ui.select).toHaveBeenCalledTimes(2)
  expect(test.run.mock.calls.filter(([, args]) =>
    args[0] === "containerapp" && args[1] === "list" && !args.includes("--resource-group"),
  )).toHaveLength(2)
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  await preserved(test)
})

it("rereads a saved configuration before retrying an actual shared-consumer blocker", async () => {
  const test = await scenario()
  const blocked = test.deployments[0]!
  const target = blocked.target
  blocked.sharedWorkloads.push({
    id: `${blocked.groupId("unrelated")}/providers/Microsoft.App/containerApps/foreign`,
    environment: `${blocked.groupId(target.config.azure.resourceGroup)}/providers/Microsoft.App/managedEnvironments/${target.config.name}-environment`,
  })
  const changed = JSON.stringify({ ...target.config, owner: "changed-team" })
  let commandsAtFailure = 0
  vi.mocked(test.ui.select).mockImplementationOnce(async () => {
    commandsAtFailure = test.run.mock.calls.length
    await writeFile(target.path, changed, { mode: 0o600 })
    blocked.saved.set(target.path, changed)
    return "retry"
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(/changed/i)

  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  await preserved(test)
})

it("retains the original preflight failure until explicit exit without opening a second recovery panel", async () => {
  const test = await scenario()
  const failure = new CommandExecutionError("Inspect Azure target failed (exit code 2).", false, 2)
  test.run.mockRejectedValue(failure)
  let exit = (_value: string) => {}
  vi.mocked(test.ui.select).mockImplementation(
    async () => new Promise<string>((resolve) => { exit = resolve }),
  )
  const settled = vi.fn()
  const pending = removeAzureDeployments(test.targets, test)
  void pending.then(settled, settled)

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledOnce())
  expect(settled).not.toHaveBeenCalled()
  expect(test.run).toHaveBeenCalledOnce()
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  exit("exit")

  await expect(pending).rejects.toBe(failure)
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(test.run).toHaveBeenCalledOnce()
  expect(test.ui.notice).toHaveBeenCalledWith(
    "error",
    expect.stringMatching(/no deployment resources were (?:removed or stopped|stopped or removed)/i),
  )
  const summary = vi.mocked(test.ui.notice!).mock.calls.at(-1)![1]
  expect(summary).not.toMatch(/partly removed|may be partly|partial deletion/i)
  expect(summary).toContain(test.targets[0]!.config.name)
  await preserved(test)
})

it("rechecks the saved target after a read-only retry instead of using newly changed configuration", async () => {
  const test = await scenario()
  const target = test.targets[0]!
  const changed = JSON.stringify({ ...target.config, owner: "changed-team" })
  test.run.mockRejectedValueOnce(
    new CommandExecutionError("Inspect Azure target failed (exit code 2).", false, 2),
  )
  vi.mocked(test.ui.select).mockImplementationOnce(async (_question, actions) => {
    await writeFile(target.path, changed, { mode: 0o600 })
    const recheck = actions.find(({ label }) => /recheck.*read.only/i.test(label))
    expect(recheck).toBeDefined()
    return recheck!.value
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(/changed/i)

  expect(test.run).toHaveBeenCalledOnce()
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(await readFile(target.path, "utf8")).toBe(changed)
  expect((await readdir(test.root)).some((name) => name.endsWith(".lock"))).toBe(false)
})

it.each(["command cancellation", "aborted signal"])(
  "never offers a removal retry after %s",
  async (cancellation) => {
    const test = await scenario()
    const abort = new AbortController()
    const failure = new CommandExecutionError(
      "Inspect Azure target cancelled.",
      cancellation === "command cancellation",
    )
    test.run.mockImplementation(async () => {
      if (cancellation === "aborted signal") abort.abort()
      throw failure
    })

    await expect(
      removeAzureDeployments(test.targets, { ...test, signal: abort.signal }),
    ).rejects.toBe(failure)

    expect(test.ui.select).not.toHaveBeenCalled()
    expect(test.ui.wait).not.toHaveBeenCalled()
    expect(test.run).toHaveBeenCalledOnce()
    expect(prepareRemovalModule).not.toHaveBeenCalled()
    await preserved(test)
  },
)

it("offers only details and exit for malformed metadata without exposing JSON snippets", async () => {
  const test = await scenario()
  const snippet = "synthetic-private-json-fragment"
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    if (args.slice(0, 3).join(" ") === "storage blob list") return snippet
    return execute(executable, args, options)
  })
  vi.mocked(test.ui.select).mockImplementation(async (_question, actions) => {
    expect(actions.map(({ value }) => value)).toEqual(["details", "exit"])
    return vi.mocked(test.ui.select).mock.calls.length === 1 ? "details" : "exit"
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toBeInstanceOf(SyntaxError)

  expect(test.ui.select).toHaveBeenCalledTimes(2)
  expect(test.ui.wait).toHaveBeenCalledOnce()
  for (const [, message] of vi.mocked(test.ui.notice!).mock.calls)
    expect(message).not.toContain(snippet)
  expect(vi.mocked(test.ui.wait).mock.calls[0]![0]).not.toContain(snippet)
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  await preserved(test)
})

it.each([
  "wrong owner",
  "wrong tenant",
  "active unrelated job",
  "unknown execution",
  "retained state lock",
  "unknown release lock",
  "foreign blob",
  "foreign historical blob",
  "foreign container",
  "missing backend",
  "shared environment",
])("blocks the whole batch before any deletion when the second target has %s", async (problem) => {
  const test = await scenario(2)
  const second = test.deployments[1]!
  if ([
    "wrong owner", "wrong tenant", "active unrelated job", "unknown execution",
    "retained state lock", "unknown release lock", "foreign blob",
    "foreign historical blob", "foreign container", "missing backend", "shared environment",
  ].includes(problem))
    for (const deployment of test.deployments)
      Object.assign(deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
        status: "locked", state: "leased", duration: "infinite",
      })
  if (problem === "wrong owner") second.badOwner = true
  if (problem === "wrong tenant") second.wrongTenant = true
  if (problem === "active unrelated job")
    second.executions = [{ name: "custom-running", status: "Running" }]
  if (problem === "unknown execution")
    second.executions = [{ name: "custom-unknown", status: null }]
  if (problem === "retained state lock")
    Object.assign(second.blobs[0]!.lease, {
      status: "locked",
      state: "leased",
      duration: "infinite",
    })
  if (problem === "unknown release lock")
    Object.assign(second.releaseLease, { status: "locked", state: "breaking", duration: "infinite" })
  if (problem === "foreign blob") second.blobs[0]!.name = "another-installation/app.tfstate"
  if (problem === "foreign historical blob")
    second.blobs.push(
      Object.assign(
        { ...second.blobs[0]! },
        {
          name: "another-installation/app.tfstate",
          current: false,
          deleted: true,
        },
      ),
    )
  if (problem === "foreign container") second.containers = ["terraform", "unrelated-data"]
  if (problem === "missing backend") second.groups.delete(second.names.stateGroup)
  if (problem === "shared environment")
    second.sharedWorkloads.push({
      id: `${second.groupId("unrelated")}/providers/Microsoft.App/containerApps/foreign`,
      environment: `${second.groupId(second.target.config.azure.resourceGroup)}/providers/Microsoft.App/managedEnvironments/${second.target.config.name}-environment`,
    })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow()

  expect(
    test.events.some((event) =>
      /:destroy:|:stop-hub|delete-backend|delete-state-group/.test(event),
    ),
  ).toBe(false)
  expect(
    test.run.mock.calls.some(([, args]) => args.includes("break") || args.includes("cancel")),
  ).toBe(false)
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(vi.mocked(test.ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual([
    ...(["retained state lock", "unknown release lock", "shared environment"].includes(problem)
      ? ["retry"] : []),
    "details",
    "exit",
  ])
  await preserved(test)
})

it.each([
  "unmanaged resource", "external foundation grant", "changed identity principal",
  "conflicting managed evidence",
])("preserves the current target's state-dependent %s guard after serially completing earlier targets", async (problem) => {
  const test = await scenario(3)
  const second = test.deployments[1]!
  const name = second.target.config.name
  if (problem === "unmanaged resource")
    second.groups.get(second.target.config.azure.resourceGroup)!.push({
      id: `${second.groupId(second.target.config.azure.resourceGroup)}/providers/Microsoft.Storage/storageAccounts/unmanaged`,
      type: "Microsoft.Storage/storageAccounts", tags: { ...second.tags },
    })
  if (problem === "external foundation grant")
    second.externalGrants.push({
      id: `${second.groupId(second.names.foundationGroup)}/providers/Microsoft.Authorization/roleAssignments/foreign`,
      scope: second.groupId(second.names.foundationGroup),
    })
  if (problem === "changed identity principal")
    second.livePrincipal = "00000000-0000-0000-0000-000000000099"
  if (problem === "conflicting managed evidence")
    await writeFile(
      join(second.directory, "environment-removal.json"),
      JSON.stringify({ version: 1, target: "another deployment", managedGroup: "ME_unrelated" }),
      { mode: 0o600 },
    )

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow()

  expect(test.events).toContain(`${test.targets[0]!.config.name}:delete-state-group`)
  expect(test.events.some((event) =>
    event.startsWith(`${name}:`) && /:destroy:|:stop-hub|delete-/.test(event),
  )).toBe(false)
  expect(test.events.some((event) =>
    event.startsWith(`${test.targets[2]!.config.name}:`),
  )).toBe(false)
  expect(second.groups.has(second.names.stateGroup)).toBe(true)
  expect(test.events.some((event) => /:lease:break:/.test(event))).toBe(false)
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(vi.mocked(test.ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual([
    ...(problem === "external foundation grant" ? ["retry"] : []),
    "details", "exit",
  ])
  await preserved(test)
})

it("rechecks an untracked grant after preparation without restarting preparation or acquiring another lease", async () => {
  const test = await scenario()
  const blocked = test.deployments[0]!
  const scope = blocked.groupId(blocked.names.foundationGroup)
  const grantId = `${scope}/providers/Microsoft.Authorization/roleAssignments/00000000-0000-0000-0000-000000000099`
  blocked.externalGrants.push({ id: grantId, scope })
  const verifyInputs = vi.fn(async () => {})
  blocked.afterVerify = verifyInputs
  const choices: ((value: string) => void)[] = []
  vi.mocked(test.ui.select).mockImplementation(
    async () => new Promise<string>((resolve) => choices.push(resolve)),
  )
  let returnFromDetails = () => {}
  vi.mocked(test.ui.wait).mockImplementationOnce(async () =>
    new Promise<void>((resolve) => { returnFromDetails = resolve }),
  )
  const settled = vi.fn()
  const pending = removeAzureDeployments(test.targets, test)
  void pending.then(settled, settled)

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledOnce())
  const commandsAtFailure = test.run.mock.calls.length
  const verificationsAtFailure = verifyInputs.mock.calls.length
  expect(prepareRemovalModule).toHaveBeenCalledTimes(3)
  expect(test.events.filter((event) => event.includes(":lease:acquire:"))).toEqual([
    `${blocked.target.config.name}:lease:acquire:installation`,
  ])
  expect(test.events.some((event) => /:stop-hub|:destroy:|delete-|:lease:break:/.test(event))).toBe(false)
  choices[0]!("details")

  await vi.waitFor(() => expect(test.ui.wait).toHaveBeenCalledOnce())
  expect(settled).not.toHaveBeenCalled()
  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(prepareRemovalModule).toHaveBeenCalledTimes(3)
  returnFromDetails()

  await vi.waitFor(() => expect(test.ui.select).toHaveBeenCalledTimes(2))
  expect(test.run).toHaveBeenCalledTimes(commandsAtFailure)
  expect(test.events.filter((event) => event.includes(":lease:acquire:"))).toHaveLength(1)
  expect(test.events.some((event) => /:stop-hub|:destroy:|delete-|:lease:break:/.test(event))).toBe(false)
  blocked.externalGrants = []
  choices[1]!("retry")

  await expect(pending).resolves.toContain("Removal finished")
  for (const [, actions] of vi.mocked(test.ui.select).mock.calls)
    expect(actions.map(({ value }) => value)).toEqual(["retry", "details", "exit"])
  const details = vi.mocked(test.ui.wait).mock.calls[0]![0]
  expect(details).toContain(scope)
  expect(details).toContain(grantId)
  expect(verifyInputs.mock.calls.length).toBeGreaterThan(verificationsAtFailure)
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(prepareRemovalModule).toHaveBeenCalledTimes(3)
  expect(test.events.filter((event) => event.includes(":lease:acquire:"))).toEqual([
    `${blocked.target.config.name}:lease:acquire:installation`,
    `${blocked.target.config.name}:lease:acquire:release`,
  ])
  await preserved(test)
})

it("allows historical versions of owned state without interpreting their old leases as current locks", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  deployment.blobs.push(
    Object.assign(
      { ...deployment.blobs[0]! },
      {
        current: false,
        version: "synthetic-old-version",
        lease: { status: "locked", state: "leased", duration: "infinite" },
      },
    ),
  )

  await expect(removeAzureDeployments(test.targets, test)).resolves.toContain(
    "owned cloud resources removed",
  )

  const blobReads = test.run.mock.calls.filter(
    ([, args]) => args.slice(0, 3).join(" ") === "storage blob list",
  )
  expect(blobReads.length).toBeGreaterThan(0)
  for (const [, args] of blobReads) {
    expect(args[args.indexOf("--include") + 1]).toBe("dsv")
    expect(args[args.indexOf("--num-results") + 1]).toBe("*")
  }
  await preserved(test)
})

it.each(["already absent", "only empty state group"])(
  "finishes an interrupted cleanup that is %s without recreating a backend or touching local files",
  async (remaining) => {
    const test = await scenario()
    const deployment = test.deployments[0]!
    deployment.groups.clear()
    if (remaining === "only empty state group")
      deployment.groups.set(deployment.names.stateGroup, [])

    await expect(removeAzureDeployments(test.targets, test)).resolves.toMatch(
      /local files retained/,
    )

    expect(prepareRemovalModule).not.toHaveBeenCalled()
    expect(test.events.some((event) => /:lease:|:destroy:|delete-backend/.test(event))).toBe(false)
    expect(test.events.includes(`${deployment.target.config.name}:delete-state-group`)).toBe(
      remaining === "only empty state group",
    )
    await preserved(test)
  },
)

it("stops a partly completed batch on failure, retains owned leases and backend, and cleans private staging", async () => {
  const test = await scenario(3)
  test.deployments[1]!.failDestroy = "app"
  const failure = new CommandExecutionError(
    "Synthetic destroy failed",
    false,
    2,
    "Synthetic ambiguous Terraform result",
  )
  test.deployments[1]!.destroyError = failure
  vi.mocked(test.ui.select).mockImplementation(async (_question, actions) => {
    expect(actions.map(({ value }) => value)).toEqual(["details", "exit"])
    return vi.mocked(test.ui.select).mock.calls.length === 1 ? "details" : "exit"
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toBe(failure)

  expect(test.events).toContain(`${test.targets[0]!.config.name}:delete-state-group`)
  expect(test.events.filter((event) => event === `${test.targets[1]!.config.name}:destroy:app`)).toHaveLength(1)
  expect(test.events).not.toContain(`${test.targets[1]!.config.name}:destroy:foundation`)
  expect(test.events).not.toContain(`${test.targets[1]!.config.name}:delete-backend`)
  expect(
    test.events.some((event) =>
      event.startsWith(`${test.targets[2]!.config.name}:`) &&
      /:lease:|:prepare:|:destroy:|:state-/.test(event),
    ),
  ).toBe(false)
  expect(test.ui.notice).toHaveBeenCalledWith(
    "error",
    expect.stringMatching(/1 selected deployment.*partly.*local.*files.*retain/i),
  )
  expect(test.ui.status).toHaveBeenCalledWith(
    expect.stringMatching(/Lock retained.*installer\.lock/),
  )
  expect(test.ui.select).toHaveBeenCalledTimes(2)
  expect(test.ui.wait).toHaveBeenCalledWith(
    expect.stringContaining("Synthetic ambiguous Terraform result"),
  )
  expect(test.ui.complete).not.toHaveBeenCalled()
  await preserved(test)
})

it("rechecks saved configuration after names are confirmed without retargeting the deployment", async () => {
  const test = await scenario()
  const target = test.targets[0]!
  const changed = JSON.stringify({ ...target.config, owner: "changed-team" })
  vi.mocked(test.ui.text).mockImplementation(async () => {
    await writeFile(target.path, changed, { mode: 0o600 })
    return target.config.name
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(/changed/i)

  expect(test.run).not.toHaveBeenCalled()
  expect(await readFile(target.path, "utf8")).toBe(changed)
  expect(await readdir(test.root)).not.toContain(`${basename(target.path)}.draft.json.lock`)
})

it("stops before deletion if saved inputs change after all selected modules were prepared", async () => {
  const test = await scenario()
  test.deployments[0]!.afterVerify = async () => {
    throw new Error("Synthetic saved module inputs changed")
  }

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(/inputs changed/i)

  expect(
    test.events.some((event) => event.includes(":destroy:") || event.includes(":stop-hub")),
  ).toBe(false)
  expect(test.ui.notice).toHaveBeenCalledWith(
    "error",
    expect.stringMatching(/no deployment resources were (?:removed or stopped|stopped or removed)/i),
  )
  expect(test.ui.status).toHaveBeenCalledWith(expect.stringMatching(/Lock retained/))
  await preserved(test)
})

it("blocks before shutdown when a current state key disappears after module preparation", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  const missing = `${deployment.target.config.name}/app.tfstate`
  const remaining = deployment.blobs.map(({ name }) => name).filter((name) => name !== missing)
  let stateChanged = false
  deployment.afterVerify = async () => {
    if (stateChanged) return
    stateChanged = true
    const index = deployment.blobs.findIndex(({ name }) => name === missing)
    expect(index).toBeGreaterThanOrEqual(0)
    deployment.blobs.splice(index, 1)
  }

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(/state.*changed/i)

  expect(stateChanged).toBe(true)
  expect(prepareRemovalModule).toHaveBeenCalledTimes(3)
  expect(test.events.some((event) => /:stop-hub|:destroy:|:empty:|delete-/.test(event))).toBe(false)
  expect(deployment.blobs.map(({ name }) => name)).toEqual(remaining)
  expect(deployment.groups.size).toBe(3)
  expect(deployment.releaseExists).toBe(true)
  expect(deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease).toMatchObject({
    status: "locked",
    state: "leased",
  })
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(vi.mocked(test.ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual([
    "details",
    "exit",
  ])
  expect(test.ui.status).toHaveBeenCalledWith(expect.stringMatching(/Lock retained/))
  await preserved(test)
})

it("uses one current HEAD per ambiguous state name instead of stale locked list rows", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  const state = deployment.blobs[0]!
  Object.assign(state.lease, { status: "locked", state: "leased", duration: "infinite" })
  deployment.blobs.push({ ...state })
  deployment.currentLeases.set(state.name, {
    status: "unlocked", state: "available", duration: null,
  })

  const result = await inspectRemoval(inspectionContext(test))

  expect(result.states).toContain(state.name)
  expect(result.retained).toEqual([])
  const currentReads = test.run.mock.calls.filter(([, args]) =>
    args.slice(0, 3).join(" ") === "storage blob show" && args.includes(state.name),
  )
  expect(currentReads).toHaveLength(1)
  expect(currentReads[0]![1]).toEqual(expect.arrayContaining(["--query", "properties.lease"]))
  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  await preserved(test)
})

it.each(["installation", "release"] as const)(
  "strict inspection still rejects a retained %s lease while approved preflight can collect it",
  async (kind) => {
    const test = await scenario()
    const deployment = test.deployments[0]!
    const blob = `${deployment.target.config.name}/installer.lock`
    const lease = { status: "locked", state: "leased", duration: "infinite" }
    if (kind === "installation") deployment.currentLeases.set(blob, lease)
    else Object.assign(deployment.releaseLease, lease)
    const context = inspectionContext(test)

    await expect(inspectRemoval(context)).rejects.toMatchObject({
      name: "RemovalLeaseError", knownRetained: true, target: { kind },
    })
    const inspection = await inspectRemoval(context, undefined, { collectRetained: true })

    expect(inspection.retained).toHaveLength(1)
    expect(inspection.retained[0]!.target.kind).toBe(kind)
    expect(inspection.retained[0]!.knownRetained).toBe(true)
    expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
    await preserved(test)
  },
)

it("reports unknown release HEAD metadata as an exact typed blocker rather than generic ownership failure", async () => {
  const test = await scenario()
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    if (args.slice(0, 3).join(" ") === "storage blob show" && args.includes("releases"))
      return "null"
    return execute(executable, args, options)
  })

  await expect(inspectRemoval(inspectionContext(test), undefined, { collectRetained: true }))
    .rejects.toMatchObject({
      name: "RemovalLeaseError", knownRetained: false,
      target: { kind: "release", container: "releases", blob: "deployment.lock" },
    })

  expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
  await preserved(test)
})

it.each(["provision.tfstate", "app.tfstate", "foundation.tfstate"])(
  "keeps default inspection strict when current %s still belongs to Terraform",
  async (suffix) => {
    const test = await scenario(2)
    const first = test.deployments[0]!
    const second = test.deployments[1]!
    Object.assign(first.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
      status: "locked", state: "leased", duration: "infinite",
    })
    const name = `${second.target.config.name}/${suffix}`
    Object.assign(second.blobs.find((blob) => blob.name === name)!.lease, {
      status: "locked", state: "leased", duration: "infinite",
    })

    const pending = inspectRemoval(inspectionContext(test, 1), undefined, { collectRetained: true })
    await expect(pending).rejects.toBeInstanceOf(RemovalLeaseError)
    await expect(pending).rejects.toMatchObject({
      knownRetained: false,
      target: {
        kind: "terraform",
        installation: second.target.config.name,
        subscription: second.target.config.azure.subscriptionId,
        account: second.names.stateAccount,
        container: "terraform",
        blob: name,
      },
    })
    const error = await pending.catch((error: Error) => error)
    expect(String(error)).toContain(`${second.names.stateAccount}/terraform/${name}`)
    expect(String(error)).toContain("Terraform state lock")
    expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
    expect(prepareRemovalModule).not.toHaveBeenCalled()
    await preserved(test)
  },
)

it.each([null, {}, { status: "locked", state: "synthetic-private-state", duration: "infinite" },
  { status: "unlocked", state: ["available"], duration: null }])(
  "refuses unknown current state even when the list claims it is only a stale lock: %j",
  async (current) => {
    const test = await scenario()
    const deployment = test.deployments[0]!
    const state = deployment.blobs[1]!
    Object.assign(state.lease, { status: "locked", state: "leased", duration: "infinite" })
    deployment.currentLeases.set(state.name, current)

    const pending = inspectRemoval(inspectionContext(test), undefined, { collectRetained: true })
    await expect(pending).rejects.toMatchObject({
      name: "RemovalLeaseError", knownRetained: false, target: { kind: "terraform", blob: state.name },
    })
    await expect(pending).rejects.not.toThrow("synthetic-private-state")
    expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
    await preserved(test)
  },
)

it("keeps typed consent while a Terraform blocker is rechecked read-only, without clearing it", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  const state = deployment.blobs[1]!
  Object.assign(state.lease, { status: "locked", state: "breaking", duration: "infinite" })
  vi.mocked(test.ui.select).mockImplementationOnce(async (_question, actions) => {
    expect(actions.map(({ value }) => value)).toEqual(["retry", "details", "exit"])
    expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
    expect(prepareRemovalModule).not.toHaveBeenCalled()
    Object.assign(state.lease, { status: "unlocked", state: "available", duration: null })
    return "retry"
  })

  await expect(removeAzureDeployments(test.targets, test)).resolves.toContain("Removal finished")

  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledOnce()
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(test.events.some((event) => event.includes(":lease:break:"))).toBe(false)
  await preserved(test)
})

it.each(["", "synthetic-private-malformed-head"])(
  "turns malformed or empty current HEAD output into an exact typed unknown blocker: %j",
  async (output) => {
    const test = await scenario()
    const deployment = test.deployments[0]!
    const state = deployment.blobs[1]!
    Object.assign(state.lease, { status: "locked", state: "leased", duration: "infinite" })
    const execute = test.run.getMockImplementation()!
    test.run.mockImplementation(async (executable, args, options) => {
      if (args.slice(0, 3).join(" ") === "storage blob show" && args.includes(state.name))
        return output
      return execute(executable, args, options)
    })
    vi.mocked(test.ui.select).mockImplementation(async (_question, actions) => {
      expect(actions.map(({ value }) => value)).toEqual(["retry", "details", "exit"])
      return vi.mocked(test.ui.select).mock.calls.length === 1 ? "details" : "exit"
    })

    await expect(removeAzureDeployments(test.targets, test)).rejects.toMatchObject({
      name: "RemovalLeaseError",
      knownRetained: false,
      target: {
        installation: deployment.target.config.name,
        subscription: deployment.target.config.azure.subscriptionId,
        kind: "terraform",
        account: deployment.names.stateAccount,
        container: "terraform",
        blob: state.name,
      },
    })

    const visible = [
      ...vi.mocked(test.ui.notice!).mock.calls.map(([, message]) => message),
      ...vi.mocked(test.ui.wait).mock.calls.map(([message]) => message),
    ].join("\n")
    expect(visible).toContain(`${deployment.names.stateAccount}/terraform/${state.name}`)
    expect(visible).toContain("status=unknown")
    expect(visible).not.toContain("synthetic-private-malformed-head")
    expect(test.ui.wait).toHaveBeenCalledOnce()
    expect(prepareRemovalModule).not.toHaveBeenCalled()
    expect(test.events.some((event) => /:lease:|:stop-hub|:destroy:|delete-/.test(event))).toBe(false)
    await preserved(test)
  },
)

it("uses batch consent for only owned operational recovery after every read-only snapshot and local writer lock", async () => {
  const test = await scenario(2)
  for (const deployment of test.deployments) {
    Object.assign(deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
      status: "locked", state: "leased", duration: "infinite",
    })
    Object.assign(deployment.releaseLease, {
      status: "locked", state: "leased", duration: "infinite",
    })
  }
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    if (args.slice(0, 4).join(" ") === "storage blob lease break") {
      for (const deployment of test.deployments)
        expect(test.run.mock.calls.some(([, call]) =>
          call.slice(0, 3).join(" ") === "storage blob list" &&
          call.includes(deployment.names.stateAccount) && call.includes("--include"),
        )).toBe(true)
      const selected = test.deployments.find((deployment) =>
        args.includes(deployment.names.stateAccount) ||
        args.includes(`${deployment.target.config.name.replaceAll("-", "")}hub`),
      )!
      expect(await readdir(selected.directory)).toContain("workspace.lock")
      expect(test.events.slice(0, 3)).toEqual([
        "confirmed", ...test.targets.map(({ config }) => `typed:${config.name}`),
      ])
    }
    return execute(executable, args, options)
  })

  await expect(removeAzureDeployments(test.targets, test)).resolves.toContain("Removal finished")

  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledTimes(2)
  expect(test.ui.select).not.toHaveBeenCalled()
  for (const { config } of test.targets) {
    for (const kind of ["installation", "release"])
      expect(test.events.filter((event) => event === `${config.name}:lease:break:${kind}`)).toHaveLength(1)
    const stopped = test.events.indexOf(`${config.name}:stop-hub`)
    const cleared = test.events.indexOf(`${config.name}:lease:break:installation`)
    expect(stopped).toBeLessThan(cleared)
    expect(test.events.indexOf(`${config.name}:lease:acquire:installation`)).toBeGreaterThan(cleared)
    expect(test.events).toContain(`${config.name}:delete-state-group`)
  }
  await preserved(test)
})

it("does not replay ambiguous operational clearing and reports Hub already stopped", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  Object.assign(deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
    status: "locked", state: "leased", duration: "infinite",
  })
  const execute = test.run.getMockImplementation()!
  const failure = new CommandExecutionError("Synthetic lock-break response was lost")
  test.run.mockImplementation(async (executable, args, options) => {
    const result = await execute(executable, args, options)
    if (args.slice(0, 4).join(" ") === "storage blob lease break") throw failure
    return result
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toBe(failure)

  expect(test.events).toContain(`${deployment.target.config.name}:stop-hub`)
  expect(test.events.filter((event) => event.includes(":lease:break:"))).toHaveLength(1)
  expect(test.events.some((event) => /:lease:acquire:|:destroy:|delete-/.test(event))).toBe(false)
  expect(prepareRemovalModule).not.toHaveBeenCalled()
  expect(test.ui.select).toHaveBeenCalledOnce()
  expect(vi.mocked(test.ui.select).mock.calls[0]![1].map(({ value }) => value)).toEqual(["details", "exit"])
  const errors = vi.mocked(test.ui.notice!).mock.calls.filter(([level]) => level === "error")
    .map(([, message]) => message).join("\n")
  expect(errors).not.toMatch(/no deployment resources were (?:removed or stopped|stopped or removed)/i)
  expect(errors).toMatch(/Hub.*stopp|shutdown|partly removed/i)
  await preserved(test)
})

it("revalidates the saved target before recovering a second operational lock", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  const target = deployment.target
  for (const lease of [
    deployment.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease,
    deployment.releaseLease,
  ])
    Object.assign(lease, { status: "locked", state: "leased", duration: "infinite" })
  const execute = test.run.getMockImplementation()!
  const changed = JSON.stringify({ ...target.config, owner: "changed-team" })
  test.run.mockImplementation(async (executable, args, options) => {
    const result = await execute(executable, args, options)
    if (args.slice(0, 4).join(" ") === "storage blob lease break")
      await writeFile(target.path, changed, { mode: 0o600 })
    return result
  })

  await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow(/changed/i)

  expect(test.events.filter((event) => event.includes(":lease:break:"))).toEqual([
    `${target.config.name}:lease:break:installation`,
  ])
  expect(test.events.some((event) => /:lease:acquire:|:destroy:|delete-/.test(event))).toBe(false)
  expect(deployment.releaseLease).toMatchObject({ status: "locked", state: "leased" })
  expect(await readFile(target.path, "utf8")).toBe(changed)
  deployment.saved.set(target.path, changed)
  await preserved(test)
})

it("recovers only verified selected state leases under the original consent and completes the first target before recovering the next", async () => {
  const test = await scenario(2)
  const first = test.deployments[0]!
  const second = test.deployments[1]!
  for (const kind of ["provision", "app", "foundation"] as const) lockState(first, kind)
  lockState(second)
  Object.assign(first.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
    status: "locked", state: "leased", duration: "infinite",
  })
  Object.assign(first.releaseLease, { status: "locked", state: "leased", duration: "infinite" })
  const execute = test.run.getMockImplementation()!
  test.run.mockImplementation(async (executable, args, options) => {
    if (executable === "terraform" && args[1] === "force-unlock") {
      for (const deployment of test.deployments)
        expect(test.run.mock.calls.some(([, call]) =>
          call.slice(0, 3).join(" ") === "storage blob list" &&
          call.includes(deployment.names.stateAccount),
        )).toBe(true)
      const selected = test.deployments.find(({ directory }) => args[0]!.includes(directory))!
      expect(await readdir(selected.directory)).toContain("workspace.lock")
      expect(selected.hubActive).toBe(false)
      if (selected === first)
        expect(await readdir(second.directory)).not.toContain("workspace.lock")
    }
    return execute(executable, args, options)
  })

  await expect(removeAzureDeployments(test.targets, test)).resolves.toContain("Removal finished")

  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledTimes(2)
  expect(test.ui.select).not.toHaveBeenCalled()
  const firstDone = test.events.indexOf(`${first.target.config.name}:delete-state-group`)
  for (const kind of ["provision", "app", "foundation"])
    expect(test.events.filter((event) =>
      event === `${first.target.config.name}:state-unlock:${kind}`,
    )).toHaveLength(1)
  expect(test.events.indexOf(`${second.target.config.name}:state-init:app`)).toBeGreaterThan(firstDone)
  expect(test.events.indexOf(`${second.target.config.name}:lease:acquire:installation`))
    .toBeGreaterThan(firstDone)
  for (const deployment of test.deployments) {
    const name = deployment.target.config.name
    const unlocks = test.events.filter((event) => event.startsWith(`${name}:state-unlock:`))
    for (const unlock of unlocks) {
      expect(test.events.indexOf(unlock)).toBeGreaterThan(test.events.indexOf(`${name}:stop-hub`))
      expect(test.events.indexOf(unlock))
        .toBeLessThan(test.events.indexOf(`${name}:lease:acquire:installation`))
    }
  }
  const breaks = test.run.mock.calls.filter(([, args]) =>
    args.slice(0, 4).join(" ") === "storage blob lease break",
  )
  expect(breaks).toHaveLength(2)
  for (const [, args] of breaks)
    expect(args[args.indexOf("--blob-name") + 1]).toMatch(/installer\.lock$|^deployment\.lock$/)
  await preserved(test)
})

it("collects valid state-lock candidates only in explicit removal recovery inspection, without clearing them", async () => {
  const test = await scenario()
  const deployment = test.deployments[0]!
  const { info } = lockState(deployment)
  const context = inspectionContext(test)

  await expect(inspectRemoval(context, undefined, { collectRetained: true }))
    .rejects.toMatchObject({
      name: "RemovalLeaseError", knownRetained: false, target: { kind: "terraform" },
    })
  const inspection = await inspectRemoval(context, undefined, {
    collectRetained: true, collectStateLocks: true,
  })

  expect(inspection.retained).toEqual([])
  expect(inspection.stateLocks).toEqual([{
    kind: "app", snapshot: { id: info.ID, fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
  }])
  expect(inspection.evidence).toMatch(/^[a-f0-9]{64}$/)
  expect(deployment.blobs.find(({ name }) => name.endsWith("app.tfstate"))!.lease)
    .toMatchObject({ status: "locked", state: "leased" })
  expect(test.events).toEqual([])
  await preserved(test)
})

it.each(["missing", "malformed", "foreign path"] as const)(
  "never starts recovery or clears operational locks when locked state metadata is %s",
  async (problem) => {
    const test = await scenario(2)
    const first = test.deployments[0]!
    const second = test.deployments[1]!
    Object.assign(first.blobs.find(({ name }) => name.endsWith("installer.lock"))!.lease, {
      status: "locked", state: "leased", duration: "infinite",
    })
    const { name, info, metadata } = lockState(second)
    if (problem === "missing") {
      const { lock: _lock, ...blobEvidence } = metadata
      second.stateMetadata.set(name, blobEvidence)
    }
    if (problem === "malformed") metadata.lock = "synthetic-private-non-base64"
    if (problem === "foreign path")
      metadata.lock = Buffer.from(JSON.stringify({
        ...info, Path: "terraform/another-installation/app.tfstate",
      })).toString("base64")

    await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow()

    expect(prepareRemovalModule).not.toHaveBeenCalled()
    expect(test.events.some((event) =>
      /:lease:|:state-init:|:state-unlock:|:stop-hub|:destroy:|delete-/.test(event),
    )).toBe(false)
    const visible = vi.mocked(test.ui.notice!).mock.calls.map(([, message]) => message).join("\n")
    expect(visible).not.toContain(info.ID)
    expect(visible).not.toContain(info.Who)
    expect(visible).not.toContain("synthetic-private-non-base64")
    await preserved(test)
  },
)

it.each(["active job", "missing ownership", "configuration drift"] as const)(
  "rechecks %s after recovery initialization and does not unlock or start a future target",
  async (problem) => {
    const test = await scenario(2)
    const deployment = test.deployments[0]!
    lockState(deployment)
    const execute = test.run.getMockImplementation()!
    test.run.mockImplementation(async (executable, args, options) => {
      const result = await execute(executable, args, options)
      if (executable === "terraform" && args[1] === "init") {
        if (problem === "active job")
          deployment.executions = [{ name: "new-database-job", status: "Running" }]
        if (problem === "missing ownership") deployment.badOwner = true
        if (problem === "configuration drift") {
          const content = JSON.stringify({ ...deployment.target.config, owner: "changed-team" })
          await writeFile(deployment.target.path, content, { mode: 0o600 })
          deployment.saved.set(deployment.target.path, content)
        }
      }
      return result
    })

    await expect(removeAzureDeployments(test.targets, test)).rejects.toThrow()

    expect(test.events).toContain(`${deployment.target.config.name}:state-init:app`)
    expect(test.events.some((event) => /:state-unlock:|:lease:|:prepare:|:destroy:|delete-/.test(event)))
      .toBe(false)
    expect(test.events).toContain(`${deployment.target.config.name}:stop-hub`)
    const visible = vi.mocked(test.ui.notice!).mock.calls.map(([, message]) => message).join("\n")
    expect(visible).not.toMatch(/no deployment resources were (?:removed or stopped|stopped or removed)/i)
    expect(visible).toMatch(/partly|stopp|shutdown/i)
    await preserved(test)
  },
)

it("does not retry or continue the batch after an ambiguous state unlock and retains every original file", async () => {
  const test = await scenario(2)
  const deployment = test.deployments[0]!
  const { info } = lockState(deployment)
  const privateDetails = `synthetic-private-unlock-output ${info.ID} ${info.Who}`
  deployment.unlockError = new CommandExecutionError(privateDetails, false, 2, privateDetails)
  vi.mocked(test.ui.select).mockImplementation(async (_question, actions) => {
    expect(actions.map(({ value }) => value)).toEqual(["details", "exit"])
    return vi.mocked(test.ui.select).mock.calls.length === 1 ? "details" : "exit"
  })
  const pending = removeAzureDeployments(test.targets, test)

  await expect(pending).rejects.toMatchObject({ name: "CommandExecutionError", exitCode: 2 })

  expect(test.events.filter((event) => event.includes(":state-unlock:"))).toEqual([
    `${deployment.target.config.name}:state-unlock:app`,
  ])
  expect(test.events.some((event) => /:lease:|:prepare:|:destroy:|delete-/.test(event))).toBe(false)
  expect(test.events.some((event) =>
    event.startsWith(`${test.targets[1]!.config.name}:`),
  )).toBe(false)
  const visible = [
    ...vi.mocked(test.ui.notice!).mock.calls.map(([, message]) => message),
    ...vi.mocked(test.ui.wait).mock.calls.map(([message]) => message),
    ...vi.mocked(test.ui.status).mock.calls.map(([message]) => message),
  ].join("\n")
  for (const privateValue of [privateDetails, info.ID, info.Who])
    expect(visible).not.toContain(privateValue)
  expect(visible).not.toMatch(/no deployment resources were (?:removed or stopped|stopped or removed)/i)
  expect(test.ui.confirm).toHaveBeenCalledOnce()
  expect(test.ui.text).toHaveBeenCalledTimes(2)
  expect(test.ui.wait).toHaveBeenCalledOnce()
  await preserved(test)
})
