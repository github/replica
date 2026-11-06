import timers from "node:timers/promises"
import { expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../../installer/command/index.ts"
import type { DeploymentConfig, InstallerUI, RunCommand } from "../../../installer/types.ts"
import { installationNames } from "../settings.ts"
import type { AzureInstallation } from "../types.ts"
import { acquireLease } from "./index.ts"

interface LeaseMetadata {
  state?: unknown
  status?: unknown
  duration?: unknown
}

function option(args: string[], name: string) {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function scenario({ existing = false, release = false, canonical = false } = {}) {
  const config: DeploymentConfig = {
    version: 1,
    cloud: "azure",
    name: "test-hub",
    owner: "test-team",
    azure: {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2",
      resourceGroup: "test-hub-group",
    },
  }
  const names = installationNames(config)
  const target = {
    account: release ? "artifactstore" : names.stateAccount,
    container: release ? "releases" : "terraform",
    blob: release ? "deployment.lock" : `${config.name}/installer.lock`,
  }
  const unlocked = () => ({ state: "available", status: "unlocked", duration: null })
  const ownedTags = {
    application: "replica-hub",
    installation: config.name,
    owner: config.owner,
    managed_by: "terraform",
  }
  const evidence = {
    lease: { state: "leased", status: "locked", duration: "infinite" } as LeaseMetadata,
    foundationTags: { ...ownedTags } as Record<string, unknown> | undefined,
    appTags: { ...ownedTags } as Record<string, unknown> | undefined,
    accountTags: { ...ownedTags } as Record<string, unknown>,
    appExists: existing,
    stateBlobs: [
      { name: `${config.name}/foundation.tfstate`, lease: unlocked() as LeaseMetadata },
      { name: `${config.name}/app.tfstate`, lease: unlocked() as LeaseMetadata },
      { name: `${config.name}/provision.tfstate`, lease: unlocked() as LeaseMetadata },
      {
        name: `${config.name}/installer.lock`,
        lease: { state: "leased", status: "locked", duration: "infinite" },
      },
    ],
    jobs: ["setup", "provision"] as unknown,
    executions: {
      setup: [
        { name: "setup-success", status: "Succeeded" },
        { name: "setup-failure", status: "Failed" },
      ],
      provision: [
        { name: "provision-stopped", status: "Stopped" },
        { name: "provision-cancelled", status: "Canceled" },
      ],
    } as Record<string, { name: string; status?: unknown }[]>,
    apps: ["hub", "retired-worker"] as unknown,
    revisions: {
      hub: [
        { name: "hub-current", active: false },
        { name: "hub-old", active: false },
      ],
      "retired-worker": [{ name: "worker-old", active: false }],
    } as Record<string, { name: string; active?: unknown }[]>,
    replicas: {
      "hub-current": [],
      "hub-old": [],
      "worker-old": [],
    } as Record<string, unknown>,
    hub: {
      id: `/subscriptions/${config.azure.subscriptionId}/resourceGroups/${config.azure.resourceGroup}/providers/Microsoft.App/containerApps/${config.name}-hub`,
      name: `${config.name}-hub`,
      tags: { ...ownedTags },
    } as unknown,
  }
  if (canonical) {
    evidence.appExists = true
    evidence.apps = [`${config.name}-hub`]
    evidence.revisions = {
      [`${config.name}-hub`]: [
        { name: "canonical-current", active: true },
        { name: "canonical-old", active: false },
      ],
    }
    evidence.replicas = {
      "canonical-current": ["current-replica"],
      "canonical-old": ["terminating-replica"],
    }
  }
  const commands: string[][] = []
  const messages: string[] = []
  const notices: { level: string; message: string }[] = []
  const choices: string[] = []
  const menus: string[][] = []
  let onSelect: ((value: string) => void) | undefined
  let onConfirm: ((message: string) => boolean) | undefined
  let onCommand: ((args: string[]) => void) | undefined
  let breakError: Error | undefined
  let acquireFailures = 0
  let afterBreak: (() => void) | undefined
  let draining = false
  let stuck = false
  const azure = vi.fn(async (...args: string[]) => {
    commands.push([...args])
    onCommand?.(args)
    const operation = args.slice(0, 3).join(" ")
    if (operation === "storage blob show") return JSON.stringify(evidence.lease)
    if (operation === "storage blob exists") return JSON.stringify({ exists: true })
    if (operation === "storage blob list") {
      expect(option(args, "--account-name")).toBe(names.stateAccount)
      expect(option(args, "--container-name")).toBe("terraform")
      expect(option(args, "--prefix")).toBe(`${config.name}/`)
      return JSON.stringify(evidence.stateBlobs)
    }
    if (operation === "storage account show") {
      expect(option(args, "--name")).toBe(target.account)
      expect(option(args, "--resource-group")).toBe(config.azure.resourceGroup)
      return JSON.stringify(evidence.accountTags)
    }
    if (operation.startsWith("group exists")) {
      const group = option(args, "--name")
      if (group === names.foundationGroup) return "true"
      if (group === config.azure.resourceGroup) return JSON.stringify(evidence.appExists)
    }
    if (operation.startsWith("group show")) {
      const group = option(args, "--name")
      if (group === names.foundationGroup) return JSON.stringify({ tags: evidence.foundationTags })
      if (group === config.azure.resourceGroup) return JSON.stringify({ tags: evidence.appTags })
    }
    if (operation === "containerapp job list") return JSON.stringify(evidence.jobs)
    if (operation === "containerapp job execution" && args[3] === "list")
      return JSON.stringify(evidence.executions[option(args, "--name")!])
    if (args.slice(0, 2).join(" ") === "containerapp list") return JSON.stringify(evidence.apps)
    if (args.slice(0, 2).join(" ") === "containerapp show") return JSON.stringify(evidence.hub)
    if (operation === "containerapp revision list") {
      const revisions = evidence.revisions[option(args, "--name")!]
      return JSON.stringify(
        option(args, "--query")
          ? revisions
          : revisions?.map(({ name, active }) => ({ name, properties: { active } })),
      )
    }
    if (operation === "containerapp replica list") {
      const revision = option(args, "--revision")!
      const replicas = evidence.replicas[revision]
      if (draining && !stuck) evidence.replicas[revision] = []
      return JSON.stringify(
        option(args, "--query") || !Array.isArray(replicas)
          ? replicas
          : replicas.map((name) => ({ name })),
      )
    }
    if (operation === "containerapp revision deactivate") {
      evidence.revisions[option(args, "--name")!]!.find(
        ({ name }) => name === option(args, "--revision"),
      )!.active = false
      draining = true
      return "{}"
    }
    if (operation === "storage blob lease") {
      if (args[3] === "break") {
        if (breakError) throw breakError
        evidence.lease = unlocked()
        afterBreak?.()
        return "{}"
      }
      if (args[3] === "acquire") {
        if (acquireFailures-- > 0) throw new CommandExecutionError("Lease acquisition conflicted")
        if (evidence.lease.status !== "unlocked")
          throw new CommandExecutionError("Lease is still owned by another installer")
        evidence.lease = { state: "leased", status: "locked", duration: "infinite" }
        return JSON.stringify("new-lease-id")
      }
      if (args[3] === "release") {
        evidence.lease = unlocked()
        return "{}"
      }
    }
    throw new Error(`Unexpected Azure command ${args.join(" ")}`)
  })
  const ui: InstallerUI = {
    status: (message) => messages.push(message),
    notice: (level, message) => {
      messages.push(message)
      notices.push({ level, message })
    },
    confirm: vi.fn(async (message: string) => {
      messages.push(message)
      return onConfirm?.(message) ?? true
    }),
    wait: vi.fn(async () => {
      throw new Error("Recovery must use explicit recheck or exit controls")
    }),
    select: vi.fn(async (_message: string, options: { label: string; value: string }[]) => {
      const values = options.map(({ value }) => value)
      menus.push(values)
      const choice = choices.shift() ?? "exit"
      if (choice !== "unknown-choice") expect(values).toContain(choice)
      onSelect?.(choice)
      return choice
    }),
  }
  const run = vi.fn<RunCommand>(async () => {
    throw new Error("Lease recovery may only use the fake Azure runner")
  })
  const context: AzureInstallation = {
    config,
    directory: process.cwd(),
    env: {},
    azure,
    run,
    ui,
  }
  return {
    context,
    config,
    target,
    names,
    evidence,
    commands,
    messages,
    notices,
    choices,
    menus,
    ui,
    acquire: () => acquireLease(context, target.account, target.container, target.blob),
    breaks: () =>
      commands.filter((args) => args.slice(0, 4).join(" ") === "storage blob lease break"),
    acquisitions: () =>
      commands.filter((args) => args.slice(0, 4).join(" ") === "storage blob lease acquire"),
    deactivations: () =>
      commands.filter((args) => args.slice(0, 3).join(" ") === "containerapp revision deactivate"),
    onSelect: (callback: (value: string) => void) => (onSelect = callback),
    onConfirm: (callback: (message: string) => boolean) => (onConfirm = callback),
    onCommand: (callback: (args: string[]) => void) => (onCommand = callback),
    failBreak: (error: Error) => (breakError = error),
    failAcquisition: () => (acquireFailures = 1),
    afterBreak: (callback: () => void) => (afterBreak = callback),
    unlock: () => (evidence.lease = unlocked()),
    stallDrain: () => (stuck = true),
  }
}

it.each([
  { existing: false, release: false, description: "before the app group exists" },
  { existing: true, release: true, description: "after the app and database exist" },
])("recovers only the selected operational lease $description", async (options) => {
  const s = scenario(options)
  s.choices.push("recover")

  const lock = await s.acquire()

  expect(vi.mocked(s.ui.select!).mock.calls[0]![1]).toContainEqual({
    label: expect.stringMatching(/clear.*lock.*continue/i),
    value: "recover",
  })
  expect(s.ui.confirm).toHaveBeenCalled()
  const acknowledgement = s.messages.join("\n")
  expect(acknowledgement).toMatch(/cannot|can't|unable|does not|doesn't/i)
  expect(acknowledgement).toMatch(/process|host|CI/)
  expect(acknowledgement).toMatch(/Terraform/i)
  if (options.existing) {
    expect(acknowledgement).toMatch(/database|DB/i)
    expect(acknowledgement).toMatch(/session/i)
    expect(acknowledgement).toMatch(/grant/i)
    expect(acknowledgement).toMatch(/partial|migration/i)
    const inspectedRevisions = s.commands
      .filter((args) => args.slice(0, 3).join(" ") === "containerapp replica list")
      .map((args) => option(args, "--revision"))
    expect(new Set(inspectedRevisions)).toEqual(new Set(["hub-current", "hub-old", "worker-old"]))
    const inspectedJobs = s.commands
      .filter((args) => args.slice(0, 4).join(" ") === "containerapp job execution list")
      .map((args) => option(args, "--name"))
    expect(new Set(inspectedJobs)).toEqual(new Set(["setup", "provision"]))
  }
  expect(
    s.commands.filter((args) => args.slice(0, 3).join(" ") === "storage blob list").length,
  ).toBeGreaterThanOrEqual(2)
  expect(s.breaks()).toHaveLength(1)
  const broken = s.breaks()[0]!
  expect(option(broken, "--account-name")).toBe(s.target.account)
  expect(option(broken, "--container-name")).toBe(s.target.container)
  expect(option(broken, "--blob-name")).toBe(s.target.blob)
  expect(option(broken, "--auth-mode")).toBe("login")
  expect(option(broken, "--lease-break-period")).toBe("0")
  const breakIndex = s.commands.indexOf(broken)
  const acquireIndex = s.commands.indexOf(s.acquisitions()[0]!)
  expect(acquireIndex).toBeGreaterThan(breakIndex)
  expect(
    s.commands
      .slice(breakIndex + 1, acquireIndex)
      .some((args) => args.slice(0, 3).join(" ") === "storage blob show"),
  ).toBe(true)
  expect(s.acquisitions()).toHaveLength(1)

  await lock.release()
  lock.reportRetained()
  const released = s.commands.find(
    (args) => args.slice(0, 4).join(" ") === "storage blob lease release",
  )!
  expect(option(released, "--lease-id")).toBe("new-lease-id")
  expect(s.messages.join("\n")).not.toMatch(/Lock retained/)
})

it("rechecks and acquires normally when the other owner releases the lease", async () => {
  const s = scenario()
  s.choices.push("retry")
  s.onSelect(() => s.unlock())

  await s.acquire()

  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(1)
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.menus.flat()).not.toContain("stop-hub")
  expect(s.deactivations()).toHaveLength(0)
})

it("does not treat non-interactive deployment approval as permission to recover a lease", async () => {
  const s = scenario()
  delete s.ui.select

  await expect(s.acquire()).rejects.toThrow("Lease is still owned")

  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.menus.flat()).not.toContain("stop-hub")
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
})

it.each(["Terraform state", "another state account", "another release blob"])(
  "refuses recovery of %s rather than a recognized operational lock",
  async (target) => {
    const s = scenario({ release: target === "another release blob" })
    if (target === "Terraform state") s.target.blob = `${s.config.name}/app.tfstate`
    else if (target === "another state account") s.target.account = "unrelatedstate"
    else s.target.blob = "another.lock"
    s.choices.push("recover", "exit")

    await expect(s.acquire()).rejects.toThrow()

    expect(s.ui.confirm).not.toHaveBeenCalled()
    expect(s.menus.flat()).not.toContain("stop-hub")
    expect(s.deactivations()).toHaveLength(0)
    expect(s.breaks()).toHaveLength(0)
    expect(s.acquisitions()).toHaveLength(0)
  },
)

it.each([false, true])(
  "stops only the verified Hub after downtime consent, then separately clears the selected lease (release=%s)",
  async (release) => {
    const s = scenario({ canonical: true, release })
    s.choices.push("recover", "stop-hub")
    vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
    const events: string[] = []
    s.onCommand((args) => {
      events.push(args.slice(0, args[0] === "storage" ? 4 : 3).join(" "))
    })
    s.onConfirm(() => {
      events.push("consent")
      return true
    })

    const lock = await s.acquire()

    expect(s.menus[0]).not.toContain("stop-hub")
    const shutdownMenu = vi
      .mocked(s.ui.select!)
      .mock.calls.find(([, options]) => options.some(({ value }) => value === "stop-hub"))!
    expect(shutdownMenu[1]).toContainEqual({
      label: expect.stringMatching(/stop Hub.*recovery.*continue/i),
      value: "stop-hub",
    })
    expect(shutdownMenu[1].map(({ value }) => value)).toEqual(
      expect.arrayContaining(["retry", "stop-hub", "exit"]),
    )
    expect(s.ui.confirm).toHaveBeenCalledTimes(2)
    const [downtime, clearing] = vi.mocked(s.ui.confirm).mock.calls.map(([message]) => message)
    expect(downtime).toMatch(/downtime|maintenance|unavailable/i)
    expect(downtime).toContain(`${s.config.name}-hub`)
    for (const required of [
      /installer/i,
      /Terraform/i,
      /release/i,
      /database|DB/i,
      /session/i,
      /review/i,
    ])
      expect(downtime).toMatch(required)
    expect(clearing).toMatch(/clear/i)
    expect(clearing).toContain(`${s.target.account}/${s.target.container}/${s.target.blob}`)
    const consents = events.flatMap((event, index) => (event === "consent" ? [index] : []))
    const stopped = events.indexOf("containerapp revision deactivate")
    const broken = events.indexOf("storage blob lease break")
    expect(stopped).toBeGreaterThan(consents[0]!)
    expect(consents[1]!).toBeGreaterThan(stopped)
    expect(broken).toBeGreaterThan(consents[1]!)
    for (const inspection of [
      "storage blob list --account-name",
      "containerapp job list",
      "containerapp show --name",
      "storage blob show --account-name",
    ])
      expect(events.slice(consents[0]! + 1, stopped)).toContain(inspection)
    expect(events.slice(stopped + 1, consents[1])).toContain("containerapp replica list")
    expect(events.slice(consents[1]! + 1, broken)).toContain("storage blob list --account-name")
    expect(events.slice(consents[1]! + 1, broken)).toContain("storage blob show --account-name")
    expect(s.deactivations()).toHaveLength(1)
    expect(option(s.deactivations()[0]!, "--revision")).toBe("canonical-current")
    const appCommands = s.commands.filter((args) => args[0] === "containerapp" && args[1] !== "job")
    for (const args of appCommands.filter((args) => option(args, "--name"))) {
      expect(option(args, "--name")).toBe(`${s.config.name}-hub`)
      expect(option(args, "--resource-group")).toBe(s.config.azure.resourceGroup)
    }
    const drainCommands = s.commands.slice(s.commands.indexOf(s.deactivations()[0]!) + 1)
    expect(
      new Set(
        drainCommands
          .filter((args) => args.slice(0, 3).join(" ") === "containerapp replica list")
          .map((args) => option(args, "--revision")),
      ),
    ).toEqual(new Set(["canonical-current", "canonical-old"]))
    expect(s.breaks()).toHaveLength(1)
    expect(option(s.breaks()[0]!, "--account-name")).toBe(s.target.account)
    expect(option(s.breaks()[0]!, "--container-name")).toBe(s.target.container)
    expect(option(s.breaks()[0]!, "--blob-name")).toBe(s.target.blob)
    if (release)
      expect(s.evidence.stateBlobs.at(-1)!.lease).toEqual({
        state: "leased",
        status: "locked",
        duration: "infinite",
      })
    expect(s.commands.some((args) => args.includes("delete") || args.includes("activate"))).toBe(
      false,
    )
    expect(s.commands.some((args) => args.slice(0, 3).join(" ") === "containerapp job start")).toBe(
      false,
    )
    expect(s.acquisitions()).toHaveLength(1)
    await lock.release()
  },
)

it.each([
  {
    description: "another app",
    change: (s: ReturnType<typeof scenario>) => {
      s.evidence.apps = [`${s.config.name}-hub`, "another-app"]
      s.evidence.revisions["another-app"] = [{ name: "another-current", active: true }]
      s.evidence.replicas["another-current"] = []
    },
  },
  {
    description: "unknown Hub revision activity",
    change: (s: ReturnType<typeof scenario>) => {
      delete s.evidence.revisions[`${s.config.name}-hub`]![1]!.active
    },
  },
  {
    description: "unknown Hub replica inventory",
    change: (s: ReturnType<typeof scenario>) => {
      s.evidence.replicas["canonical-old"] = null
    },
  },
  {
    description: "a failed ownership inspection",
    change: (s: ReturnType<typeof scenario>) => {
      s.onCommand((args) => {
        if (args.slice(0, 2).join(" ") === "containerapp show")
          throw new CommandExecutionError("Hub ownership inspection denied")
      })
    },
  },
])("does not authorize shutdown when inspection finds $description", async ({ change }) => {
  const s = scenario({ canonical: true })
  change(s)
  s.choices.push("recover", "exit")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.menus.flat()).not.toContain("stop-hub")
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
})

it.each([
  "application",
  "installation",
  "owner",
  "managed_by",
  "subscription",
  "resource group",
  "full app ID",
  "app name",
  "unknown app metadata",
])("requires matching app ownership and identity rather than group tags: %s", async (field) => {
  const s = scenario({ canonical: true })
  const hub = s.evidence.hub as { id: string; name: string; tags: Record<string, string> }
  if (field in hub.tags) hub.tags[field] = "foreign"
  else if (field === "subscription")
    hub.id = hub.id.replace(s.config.azure.subscriptionId, "foreign")
  else if (field === "resource group")
    hub.id = hub.id.replace(s.config.azure.resourceGroup, "foreign")
  else if (field === "full app ID") hub.id = `${hub.id}/revisions/other`
  else if (field === "app name") hub.name = "foreign-hub"
  else s.evidence.hub = null
  s.choices.push("recover", "exit")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.menus.flat()).not.toContain("stop-hub")
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
})

it("refreshes shutdown eligibility before asking for downtime approval", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
  s.onSelect((value) => {
    if (value === "stop-hub") s.evidence.executions.setup![0]!.status = "Running"
  })

  await expect(s.acquire()).rejects.toThrow()

  expect(s.menus.flat()).toContain("stop-hub")
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
})

it("removes Hub shutdown eligibility after a fresh post-consent inspection fails", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  let consentAccepted = false
  s.onConfirm(() => {
    consentAccepted = true
    return true
  })
  s.onCommand((args) => {
    if (consentAccepted && args.slice(0, 3).join(" ") === "storage blob list")
      throw new CommandExecutionError("Fresh recovery inspection denied")
  })

  await expect(s.acquire()).rejects.toThrow("Fresh recovery inspection denied")

  expect(s.menus.some((menu) => menu.includes("stop-hub"))).toBe(true)
  expect(s.menus.at(-1)).toEqual(["retry", "exit"])
  expect(s.ui.confirm).toHaveBeenCalledTimes(1)
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("keeps shutdown optional and returns to diagnostics after downtime approval is declined", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  s.onConfirm(() => false)

  await expect(s.acquire()).rejects.toThrow()

  expect(s.ui.confirm).toHaveBeenCalledTimes(1)
  expect(s.menus.at(-1)).toEqual(expect.arrayContaining(["retry", "exit"]))
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it.each([
  "state",
  "job",
  "ownership",
  "selected lease",
  "Hub activity",
  "a new Hub revision",
  "replica identity",
  "terminal job execution",
])("does not mutate after downtime consent when %s evidence changes", async (field) => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
  let consents = 0
  s.onConfirm(() => {
    if (++consents > 1) return false
    if (field === "state") s.evidence.stateBlobs[0]!.lease = { state: "leased", status: "locked" }
    else if (field === "job") s.evidence.executions.provision![0]!.status = "Running"
    else if (field === "ownership")
      (s.evidence.hub as { tags: Record<string, string> }).tags.owner = "foreign"
    else if (field === "selected lease")
      s.evidence.lease = { state: "breaking", status: "locked", duration: "infinite" }
    else if (field === "Hub activity") {
      s.evidence.revisions[`${s.config.name}-hub`]![0]!.active = false
      s.evidence.replicas["canonical-current"] = []
      s.evidence.replicas["canonical-old"] = []
    } else if (field === "a new Hub revision") {
      s.evidence.revisions[`${s.config.name}-hub`]!.push({
        name: "canonical-new",
        active: true,
      })
      s.evidence.replicas["canonical-new"] = []
    } else if (field === "replica identity")
      s.evidence.replicas["canonical-old"] = ["replacement-replica"]
    else s.evidence.executions.setup![0]!.status = "Failed"
    return true
  })

  await expect(s.acquire()).rejects.toThrow()

  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
  expect(s.ui.confirm).toHaveBeenCalledTimes(1)
})

it("continues approved recovery when Azure only reorders inspection lists during consent", async () => {
  const s = scenario({ canonical: true })
  s.evidence.replicas["canonical-old"] = ["older-replica", "terminating-replica"]
  s.choices.push("recover", "stop-hub")
  vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
  s.onConfirm(() => {
    s.evidence.stateBlobs.reverse()
    const jobs = s.evidence.jobs as string[]
    jobs.reverse()
    for (const executions of Object.values(s.evidence.executions)) executions.reverse()
    s.evidence.revisions[`${s.config.name}-hub`]!.reverse()
    for (const replicas of Object.values(s.evidence.replicas)) (replicas as string[]).reverse()
    return true
  })

  const lock = await s.acquire()

  expect(s.ui.confirm).toHaveBeenCalledTimes(2)
  expect(s.deactivations()).toHaveLength(1)
  expect(option(s.deactivations()[0]!, "--revision")).toBe("canonical-current")
  expect(s.breaks()).toHaveLength(1)
  expect(s.acquisitions()).toHaveLength(1)
  await lock.release()
})

it("does not reuse downtime approval as permission to clear the lease", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
  let consents = 0
  s.onConfirm(() => ++consents === 1)

  await expect(s.acquire()).rejects.toThrow()

  expect(s.deactivations()).toHaveLength(1)
  expect(s.ui.confirm).toHaveBeenCalledTimes(2)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("does not clear after a terminal execution changes during separate clearing consent", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
  let consents = 0
  s.onConfirm(() => {
    if (++consents === 2) s.evidence.executions.setup![0]!.status = "Failed"
    return true
  })

  await expect(s.acquire()).rejects.toThrow()

  expect(s.deactivations()).toHaveLength(1)
  expect(s.ui.confirm).toHaveBeenCalledTimes(2)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("rechecks all safety gates after shutdown rather than trusting a completed drain", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
  s.onCommand((args) => {
    if (args.slice(0, 3).join(" ") === "containerapp revision deactivate")
      s.evidence.executions.setup![0]!.status = "Running"
  })

  await expect(s.acquire()).rejects.toThrow()

  expect(s.deactivations()).toHaveLength(1)
  expect(s.ui.confirm).toHaveBeenCalledTimes(1)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it.each(["after drain", "during clearing consent"])(
  "preserves the lock when verified Hub ownership changes %s",
  async (when) => {
    const s = scenario({ canonical: true })
    s.choices.push("recover", "stop-hub", "exit")
    vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
    const changeOwnership = () =>
      ((s.evidence.hub as { tags: Record<string, string> }).tags.owner = "another-team")
    if (when === "after drain") {
      s.onCommand((args) => {
        if (args.slice(0, 3).join(" ") === "containerapp revision deactivate") changeOwnership()
      })
    } else {
      let consents = 0
      s.onConfirm(() => {
        if (++consents === 2) changeOwnership()
        return true
      })
    }

    await expect(s.acquire()).rejects.toThrow(/ownership|identity|verified/i)

    expect(s.deactivations()).toHaveLength(1)
    expect(s.ui.confirm).toHaveBeenCalledTimes(when === "after drain" ? 1 : 2)
    expect(s.breaks()).toHaveLength(0)
    expect(s.acquisitions()).toHaveLength(0)
    expect(s.menus.at(-1)).toEqual(["retry", "exit"])
  },
)

it.each(["deactivation", "replica inspection", "timeout", "cancellation"])(
  "does not clear or acquire the lease, or report successful shutdown, after drain %s",
  async (failure) => {
    const s = scenario({ canonical: true })
    s.choices.push("recover", "stop-hub", "exit")
    vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
    let now = 0
    if (failure === "timeout") {
      s.stallDrain()
      vi.spyOn(performance, "now").mockImplementation(() => now)
      vi.spyOn(timers, "setTimeout").mockImplementation(async () => {
        now += 5_000
      })
    }
    s.onCommand((args) => {
      const operation = args.slice(0, 3).join(" ")
      if (operation === "containerapp revision deactivate") {
        if (failure === "deactivation") throw new CommandExecutionError("Deactivation denied")
        if (failure === "cancellation") throw new CommandExecutionError("Cancelled", true)
      }
      if (
        failure === "replica inspection" &&
        operation === "containerapp replica list" &&
        s.deactivations().length
      )
        throw new CommandExecutionError("Drain inspection denied")
    })

    await expect(s.acquire()).rejects.toThrow()

    expect(s.ui.confirm).toHaveBeenCalledTimes(1)
    expect(s.breaks()).toHaveLength(0)
    expect(s.acquisitions()).toHaveLength(0)
    expect(
      s.notices.some(
        ({ level, message }) => level === "success" && /stopp|shutdown/i.test(message),
      ),
    ).toBe(false)
    if (failure !== "cancellation")
      expect(s.menus.at(-1)).toEqual(expect.arrayContaining(["retry", "exit"]))
    else expect(s.choices).toEqual(["exit"])
  },
)

it("propagates cancelled downtime consent without stopping Hub", async () => {
  const s = scenario({ canonical: true })
  s.choices.push("recover", "stop-hub", "exit")
  const cancelled = new DOMException("Cancelled", "AbortError")
  s.ui.confirm = vi.fn(async () => {
    throw cancelled
  })

  await expect(s.acquire()).rejects.toBe(cancelled)

  expect(s.choices).toEqual(["exit"])
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("does not stop an active canonical Hub in a noninteractive approved deployment", async () => {
  const s = scenario({ canonical: true })
  delete s.ui.select

  await expect(s.acquire()).rejects.toThrow()

  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
})

it("refuses to recover a release lock in a storage account owned by another installation", async () => {
  const s = scenario({ canonical: true, release: true })
  s.evidence.accountTags.owner = "another-team"
  s.choices.push("recover", "retry", "exit")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.choices).toHaveLength(0)
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.menus.flat()).not.toContain("stop-hub")
  expect(s.deactivations()).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("returns to recovery options after declining and exits without breaking or acquiring", async () => {
  const s = scenario()
  s.choices.push("recover", "exit")
  s.onConfirm(() => false)

  await expect(s.acquire()).rejects.toThrow()

  expect(s.ui.confirm).toHaveBeenCalled()
  const [question, options] = vi.mocked(s.ui.select!).mock.calls.at(-1)!
  expect(question).toMatch(/lock.*(?:not cleared|unchanged)|did not clear/i)
  expect(question).toMatch(/not authorized|authorization.*declined|declined.*authorization/i)
  expect(options.map(({ value }) => value)).toEqual(["retry", "exit"])
  expect(s.choices).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("rejects an unknown recovery choice instead of treating it as consent", async () => {
  const s = scenario()
  s.choices.push("unknown-choice")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.breaks()).toHaveLength(0)
})

it.each([
  {
    description: "a finite lease",
    lease: { state: "leased", status: "locked", duration: "fixed" },
  },
  {
    description: "a changing lease",
    lease: { state: "breaking", status: "locked", duration: "infinite" },
  },
  { description: "unknown lease metadata", lease: {} },
])("offers only recheck and exit for $description", async ({ lease }) => {
  const s = scenario({ canonical: true })
  s.evidence.lease = lease
  s.choices.push("retry", "exit")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.menus).toHaveLength(2)
  for (const menu of s.menus) {
    expect(menu).toEqual(expect.arrayContaining(["retry", "exit"]))
    expect(menu).not.toContain("recover")
    expect(menu).not.toContain("stop-hub")
  }
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

const blockers: {
  description: string
  reason: RegExp
  change: (s: ReturnType<typeof scenario>) => void
}[] = [
  {
    description: "foreign foundation ownership",
    reason: /ownership|belong|another.*installation/i,
    change: (s) => {
      s.evidence.foundationTags!.owner = "another-team"
    },
  },
  {
    description: "foreign app ownership",
    reason: /ownership|belong|another.*installation/i,
    change: (s) => {
      s.evidence.appTags!.installation = "another-installation"
    },
  },
  {
    description: "missing ownership metadata",
    reason: /ownership|belong|another.*installation/i,
    change: (s) => {
      s.evidence.appTags = undefined
    },
  },
  {
    description: "a leased Terraform state",
    reason: /provision\.tfstate.*(?:locked|unknown)/i,
    change: (s) => {
      s.evidence.stateBlobs[2]!.lease = {
        state: "leased",
        status: "locked",
        duration: "infinite",
      }
    },
  },
  {
    description: "unknown Terraform lease metadata",
    reason: /app\.tfstate.*(?:locked|unknown)/i,
    change: (s) => {
      s.evidence.stateBlobs[1]!.lease = {}
    },
  },
  {
    description: "a running job",
    reason: /provision.*provision-stopped.*Running/i,
    change: (s) => {
      s.evidence.executions.provision![0]!.status = "Running"
    },
  },
  {
    description: "an unknown job status",
    reason: /unknown job execution metadata/i,
    change: (s) => {
      delete s.evidence.executions.setup![0]!.status
    },
  },
  {
    description: "an active app revision",
    reason: /hub-current.*active/i,
    change: (s) => {
      s.evidence.revisions.hub![0]!.active = true
    },
  },
  {
    description: "unknown revision activity",
    reason: /unknown revision metadata/i,
    change: (s) => {
      delete s.evidence.revisions.hub![1]!.active
    },
  },
  {
    description: "replicas on an inactive old revision",
    reason: /hub-old.*replica/i,
    change: (s) => {
      s.evidence.replicas["hub-old"] = ["still-running-replica"]
    },
  },
  {
    description: "an incomplete app inventory",
    reason: /(?:unknown|did not return).*inspection list/i,
    change: (s) => {
      s.evidence.apps = null
    },
  },
  {
    description: "an incomplete replica inventory",
    reason: /(?:unknown|did not return).*inspection list/i,
    change: (s) => {
      s.evidence.replicas["worker-old"] = null
    },
  },
]

it.each(blockers)(
  "keeps the reason and only safety recheck or exit visible for $description",
  async ({ change, reason }) => {
    const s = scenario({ existing: true })
    change(s)
    s.choices.push("recover", "retry", "exit")

    await expect(s.acquire()).rejects.toThrow(reason)

    expect(s.choices).toHaveLength(0)
    expect(s.menus.slice(1)).toEqual([
      ["retry", "exit"],
      ["retry", "exit"],
    ])
    for (const [question, options] of vi.mocked(s.ui.select!).mock.calls.slice(1)) {
      expect(question).toMatch(
        /lock.*(?:not cleared|unchanged)|did not clear|recovery (?:did not complete|could not be verified)/i,
      )
      expect(question).toMatch(reason)
      expect(options).toContainEqual({
        label: expect.stringMatching(/recheck/i),
        value: "retry",
      })
    }
    expect(
      s.commands.filter((args) => args.slice(0, 3).join(" ") === "storage blob list"),
    ).toHaveLength(2)
    expect(s.ui.confirm).not.toHaveBeenCalled()
    expect(s.breaks()).toHaveLength(0)
    expect(s.acquisitions()).toHaveLength(0)
  },
)

it("rechecks an unresolved blocker and requires fresh consent and inspection once it resolves", async () => {
  const s = scenario({ existing: true, release: true })
  s.evidence.replicas["hub-old"] = ["still-running-replica"]
  s.choices.push("recover", "retry", "retry")
  const events: string[] = []
  let rechecks = 0
  s.onSelect((choice) => {
    if (choice !== "retry") return
    expect(s.ui.confirm).not.toHaveBeenCalled()
    expect(s.breaks()).toHaveLength(0)
    if (++rechecks === 2) s.evidence.replicas["hub-old"] = []
  })
  s.onCommand((args) => {
    if (args.slice(0, 3).join(" ") === "storage blob list") events.push("inspection")
    if (args.slice(0, 4).join(" ") === "storage blob lease break") events.push("break")
  })
  s.onConfirm(() => {
    events.push("confirmation")
    return true
  })

  const lock = await s.acquire()

  expect(s.menus.slice(1)).toEqual([
    ["retry", "exit"],
    ["retry", "exit"],
  ])
  for (const [question] of vi.mocked(s.ui.select!).mock.calls.slice(1)) {
    expect(question).toMatch(/lock.*(?:not cleared|unchanged)|did not clear/i)
    expect(question).toMatch(/hub-old.*replica/i)
  }
  expect(events).toEqual([
    "inspection",
    "inspection",
    "inspection",
    "confirmation",
    "inspection",
    "break",
  ])
  expect(s.ui.confirm).toHaveBeenCalledTimes(1)
  expect(s.breaks()).toHaveLength(1)
  expect(option(s.breaks()[0]!, "--account-name")).toBe(s.target.account)
  expect(option(s.breaks()[0]!, "--container-name")).toBe(s.target.container)
  expect(option(s.breaks()[0]!, "--blob-name")).toBe(s.target.blob)
  expect(s.acquisitions()).toHaveLength(1)
  await lock.release()
})

it("repeats safety checks after consent and refuses evidence that changed during review", async () => {
  const s = scenario({ existing: true })
  s.choices.push("recover", "exit")
  s.onConfirm(() => {
    s.evidence.replicas["hub-old"] = ["new-replica"]
    return true
  })

  await expect(s.acquire()).rejects.toThrow()

  const [question, options] = vi.mocked(s.ui.select!).mock.calls.at(-1)!
  expect(question).toMatch(/lock.*(?:not cleared|unchanged)|did not clear/i)
  expect(question).toMatch(/hub-old.*replica/i)
  expect(options.map(({ value }) => value)).toEqual(["retry", "exit"])
  expect(s.ui.confirm).toHaveBeenCalled()
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("rechecks the selected lease after consent and refuses a lease that is now changing", async () => {
  const s = scenario()
  s.choices.push("recover", "exit")
  s.onConfirm(() => {
    s.evidence.lease = { state: "breaking", status: "locked", duration: "infinite" }
    return true
  })

  await expect(s.acquire()).rejects.toThrow()

  const [question, options] = vi.mocked(s.ui.select!).mock.calls.at(-1)!
  expect(question).toMatch(/lock.*(?:not cleared|unchanged)|did not clear/i)
  expect(question).toMatch(/lease.*changed|changed.*lease/i)
  expect(options.map(({ value }) => value)).toEqual(["retry", "exit"])
  expect(s.ui.confirm).toHaveBeenCalled()
  expect(s.breaks()).toHaveLength(0)
  expect(s.acquisitions()).toHaveLength(0)
})

it("surfaces failed inspection and permits recheck or exit without a mutation", async () => {
  const s = scenario({ existing: true })
  s.choices.push("recover", "retry", "exit")
  s.onCommand((args) => {
    if (args.slice(0, 3).join(" ") === "containerapp revision list")
      throw new CommandExecutionError("Revision inspection denied")
  })

  await expect(s.acquire()).rejects.toThrow("Revision inspection denied")

  for (const [question, options] of vi.mocked(s.ui.select!).mock.calls.slice(1)) {
    expect(question).toMatch(/recovery (?:did not complete|could not be verified)/i)
    expect(question).toContain("Revision inspection denied")
    expect(options.map(({ value }) => value)).toEqual(["retry", "exit"])
  }
  expect(s.choices).toHaveLength(0)
  expect(s.breaks()).toHaveLength(0)
  expect(s.ui.confirm).not.toHaveBeenCalled()
})

it.each([
  {
    description: "UI cancellation",
    error: new DOMException("Cancelled", "AbortError"),
    source: "ui",
  },
  {
    description: "inspection cancellation",
    error: new CommandExecutionError("Cancelled", true),
    source: "inspection",
  },
  {
    description: "acquisition cancellation",
    error: new CommandExecutionError("Cancelled", true),
    source: "acquisition",
  },
])("propagates $description without presenting a recovery retry", async ({ error, source }) => {
  const s = scenario({ existing: true })
  s.choices.push("recover")
  if (source === "ui")
    s.ui.select = vi.fn(async () => {
      throw error
    })
  else if (source === "inspection") {
    s.onCommand((args) => {
      if (args.slice(0, 3).join(" ") === "containerapp revision list") throw error
    })
  } else {
    s.unlock()
    s.onCommand((args) => {
      if (args.slice(0, 4).join(" ") === "storage blob lease acquire") throw error
    })
  }

  await expect(s.acquire()).rejects.toBe(error)

  expect(s.breaks()).toHaveLength(0)
  expect(s.ui.confirm).not.toHaveBeenCalled()
  expect(s.menus).toHaveLength(source === "inspection" ? 1 : 0)
})

it("does not replay an ambiguous failed break or attempt acquisition afterward", async () => {
  const s = scenario()
  const failure = new CommandExecutionError("Break response was lost")
  s.choices.push("recover", "exit")
  s.failBreak(failure)

  const stopped = s.acquire()
  await expect(stopped).rejects.toThrow(failure.message)
  await expect(stopped).rejects.not.toThrow(/locks? (?:were |was )?preserved/i)

  const [question, options] = vi.mocked(s.ui.select!).mock.calls.at(-1)!
  expect(question).toContain(failure.message)
  expect(question).toMatch(/could not be verified|did not complete|do not assume.*cleared/i)
  expect(question).not.toMatch(/lock.*(?:not cleared|unchanged)|did not clear/i)
  expect(options.map(({ value }) => value)).toEqual(["retry", "exit"])
  expect(s.breaks()).toHaveLength(1)
  expect(s.acquisitions()).toHaveLength(0)
})

it.each([
  {
    description: "Azure still reports a changing lease",
    reason: /not confirmed.*unlocked|not.*verif.*unlocked/i,
    change: (s: ReturnType<typeof scenario>) => {
      s.evidence.lease = { state: "breaking", status: "locked", duration: "infinite" }
    },
  },
  {
    description: "post-break inspection fails",
    reason: /Post-break lease inspection denied/,
    change: (s: ReturnType<typeof scenario>) => {
      s.onCommand((args) => {
        if (args.slice(0, 3).join(" ") === "storage blob show")
          throw new CommandExecutionError("Post-break lease inspection denied")
      })
    },
  },
])(
  "keeps clearing uncertain and does not acquire when $description",
  async ({ reason, change }) => {
    const s = scenario()
    s.choices.push("recover", "exit")
    s.afterBreak(() => change(s))

    await expect(s.acquire()).rejects.toThrow(reason)

    const [question, options] = vi.mocked(s.ui.select!).mock.calls.at(-1)!
    expect(question).toMatch(reason)
    expect(question).toMatch(/could not be verified|did not complete|do not assume.*cleared/i)
    expect(question).not.toMatch(/lock.*(?:not cleared|unchanged)|did not clear/i)
    expect(options.map(({ value }) => value)).toEqual(["retry", "exit"])
    expect(s.breaks()).toHaveLength(1)
    expect(s.acquisitions()).toHaveLength(0)
  },
)

it("retries a failed normal acquisition only on an explicit retry choice", async () => {
  const s = scenario()
  s.unlock()
  s.failAcquisition()
  s.choices.push("retry")

  await s.acquire()

  expect(s.acquisitions()).toHaveLength(2)
  expect(s.breaks()).toHaveLength(0)
  expect(s.menus).toEqual([expect.arrayContaining(["retry", "exit"])])
  expect(s.menus[0]).not.toContain("recover")
})

it.each(
  blockers.filter(({ description }) =>
    [
      "foreign foundation ownership",
      "foreign app ownership",
      "missing ownership metadata",
      "a leased Terraform state",
      "unknown Terraform lease metadata",
      "a running job",
      "an unknown job status",
      "an incomplete app inventory",
    ].includes(description),
  ),
)(
  "does not offer Hub shutdown with canonical Hub activity and $description",
  async ({ change }) => {
    const s = scenario({ canonical: true })
    change(s)
    s.choices.push("recover", "exit")

    await expect(s.acquire()).rejects.toThrow()

    expect(s.menus.flat()).not.toContain("stop-hub")
    expect(s.ui.confirm).not.toHaveBeenCalled()
    expect(s.deactivations()).toHaveLength(0)
    expect(s.breaks()).toHaveLength(0)
  },
)
