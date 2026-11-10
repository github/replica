import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setImmediate } from "node:timers/promises"
import { afterEach, expect, it, vi } from "vitest"

import { openSession } from "../session/index.ts"
import type { DeploymentConfig, RunCommand, WizardPhase, WizardUI } from "../types.ts"
import { runWizard } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []

function postgresCatalogue() {
  return JSON.stringify([{
    status: null, reason: null, restricted: null,
    supportedServerVersions: [{ name: "17", status: null, reason: null }],
    supportedServerEditions: [{
      name: "Burstable", status: null, reason: null,
      supportedServerSkus: [{ name: "Standard_B1ms", status: null, reason: null }],
    }],
  }])
}

function savedConfiguration(): DeploymentConfig {
  return {
    version: 1, cloud: "azure", name: "team-hub", owner: "platform-team",
    azure: {
      tenantId: "00000000-0000-0000-0000-000000000001",
      subscriptionId: "00000000-0000-0000-0000-000000000002",
      location: "eastus2", resourceGroup: "team-hub-rg",
    },
  }
}

async function target() {
  const directory = resolve(`.installer-wizard-session-test-${randomUUID()}`)
  directories.push(directory)
  await mkdir(directory, { mode: 0o700 })
  const path = join(directory, "installation.json")
  const session = await openSession(path)
  sessions.push(session)
  return { directory, path, session }
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

it("rechecks SKU support on resume and reselects an incompatible draft region without losing independent answers", async () => {
  const { directory, path, session } = await target()
  const tenantId = "00000000-0000-0000-0000-000000000001"
  const subscriptionId = "00000000-0000-0000-0000-000000000002"
  const interrupted = new Error("Synthetic questionnaire interruption")
  const regions = [{ name: "eastus2", displayName: "East US 2" }]
  let supportedLocation = "eastus2"
  let activeSession = session
  const completedPhases: WizardPhase[] = []
  const prerequisitePhases: (WizardPhase | undefined)[] = []
  const checkpointPhases: (WizardPhase | undefined)[] = []
  const first: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    field: vi.fn(async (field) => {
      return field.parse(field.id === "name" ? "team-hub" : "platform-team")
    }),
    text: vi.fn(async () => {
      throw new Error("Unexpected legacy text prompt")
    }),
    select: vi.fn<WizardUI["select"]>(async (_message, options) => options[0]!.value),
    confirm: vi.fn(async () => { throw interrupted }),
    wait: vi.fn(async (message) => {
      throw new Error(message)
    }),
    status: vi.fn(),
    phase: async (phase) => {
      await setImmediate()
      completedPhases.push(phase)
    },
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (args[0] === "version" && executable === "az") {
      prerequisitePhases.push(completedPhases.at(-1))
      checkpointPhases.push(activeSession.draft?.phase)
    }
    if (executable === "terraform" && args.includes("version"))
      return JSON.stringify({ terraform_version: "1.13.4" })
    if (executable === "docker") {
      if (args.some((arg) => ["build", "push", "login"].includes(arg)))
        throw new Error("Configure-only attempted a container mutation")
      return ""
    }
    if (executable !== "az") throw new Error(`Unexpected executable ${executable}`)
    if (args[0] === "version") return "{}"
    if (args.includes("--help")) return ""
    if (args.slice(0, 3).join(" ") === "postgres flexible-server list-skus")
      return args[args.indexOf("--location") + 1] === supportedLocation ? postgresCatalogue() : "[]"
    if (args[0] === "account" && args[1] === "list") {
      return JSON.stringify([
        {
          id: subscriptionId,
          tenantId,
          name: "Authorized subscription",
          state: "Enabled",
        },
      ])
    }
    if (args[0] === "rest" && args[args.indexOf("--method") + 1]?.toLowerCase() === "get") {
      expect(args[args.indexOf("--subscription") + 1]).toBe(subscriptionId)
      return JSON.stringify(regions)
    }
    if (args[0] === "provider" && args[1] === "show") {
      return JSON.stringify({
        resourceTypes: ["managedEnvironments", "flexibleServers", "registries", "vaults"].map(
          (resourceType) => ({ resourceType, locations: regions.map(({ displayName }) => displayName) }),
        ),
      })
    }
    throw new Error(`Configure-only attempted an unexpected operation ${args.join(" ")}`)
  })

  await expect(
    runWizard({ ui: first, run, path, directory, session, configureOnly: true }),
  ).rejects.toBe(interrupted)
  expect(prerequisitePhases).toEqual(["checks"])
  expect(checkpointPhases).toEqual(["checks"])
  expect(session.draft?.answers).toMatchObject({
    cloud: "azure",
    tenantId,
    subscriptionId,
    location: "eastus2",
    name: "team-hub",
    owner: "platform-team",
    resourceGroup: "team-hub-hub",
  })
  await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  await session.close()
  activeSession = await openSession(path)
  sessions.push(activeSession)
  regions.push({ name: "westus2", displayName: "West US 2" })
  supportedLocation = "westus2"
  completedPhases.length = 0
  prerequisitePhases.length = 0
  checkpointPhases.length = 0
  run.mockClear()
  const resumed: WizardUI = {
    ...first,
    welcome: vi.fn(),
    cloud: vi.fn(async () => "azure" as const),
    field: vi.fn(async () => { throw new Error("Saved fields must not be asked again") }),
    confirm: vi.fn(async () => false),
    select: vi.fn<WizardUI["select"]>(async (_message, options) => {
      expect(options.map(({ value }) => value)).toEqual(["westus2"])
      return "westus2"
    }),
  }

  await runWizard({
    ui: resumed,
    run,
    path,
    directory,
    session: activeSession,
    configureOnly: true,
  })

  expect(resumed.cloud).not.toHaveBeenCalled()
  expect(resumed.welcome).not.toHaveBeenCalled()
  expect(prerequisitePhases).toEqual(["checks"])
  expect(checkpointPhases).toEqual(["checks"])
  expect(resumed.field).not.toHaveBeenCalled()
  expect(resumed.select).toHaveBeenCalledOnce()
  expect(run.mock.calls.some(([, args]) => args[0] === "account" && args[1] === "list")).toBe(true)
  expect(run.mock.calls.some(([, args]) => args[0] === "rest")).toBe(true)
  expect(run.mock.calls.filter(([, args]) => args[0] === "provider")).toHaveLength(4)
  expect(run.mock.calls.filter(([, args]) => args[0] === "postgres").map(([, args]) =>
    args[args.indexOf("--location") + 1])).toEqual(["eastus2", "westus2"])
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    cloud: "azure",
    name: "team-hub",
    owner: "platform-team",
    azure: { tenantId, subscriptionId, location: "westus2", resourceGroup: "team-hub-hub" },
  })
  await expect(readFile(activeSession.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
})

it("warns and obtains fresh deployment consent after interruption without a separate resume acknowledgement", async () => {
  const { directory, path, session } = await target()
  const existing = savedConfiguration()
  await writeFile(path, JSON.stringify(existing), { mode: 0o600 })
  await session.answer("cloud", "azure")
  await session.answer("useProxy", false)
  const events: string[] = []
  const interrupted = new Error("Synthetic interruption at the first cloud write")
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    text: vi.fn(),
    select: vi.fn(async () => { throw new Error("Entry already selected Resume") }),
    confirm: vi.fn(async () => {
      events.push("approval")
      return true
    }),
    wait: vi.fn(async () => {
      throw new Error("Resume must not require another acknowledgement")
    }),
    status: vi.fn(),
    notice: vi.fn((level) => {
      events.push(`notice:${level}`)
    }),
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    if (executable === "git") {
      events.push("source")
      return args[0] === "rev-parse" ? "a".repeat(40) : ""
    }
    if (executable === "terraform" && args[0] === "version")
      return JSON.stringify({ terraform_version: "1.13.4" })
    if (executable === "docker" && !args.some((arg) => ["build", "push", "login"].includes(arg)))
      return ""
    if (executable === "az") {
      if (args[0] === "version" || args.includes("--help")) return "{}"
      if (args.slice(0, 3).join(" ") === "postgres flexible-server list-skus")
        return postgresCatalogue()
      if (args[0] === "account" && args[1] === "list") {
        events.push("checks")
        return JSON.stringify([{
          id: existing.azure.subscriptionId,
          tenantId: existing.azure.tenantId,
          name: "Authorized subscription",
          state: "Enabled",
        }])
      }
      if (args[0] === "account" && args[1] === "show") return JSON.stringify({
        id: existing.azure.subscriptionId,
        tenantId: existing.azure.tenantId,
      })
      if (args[0] === "rest")
        return JSON.stringify([{ name: "eastus2", displayName: "East US 2" }])
      if (args[0] === "provider" && args[1] === "show")
        return JSON.stringify({
          registrationState: "Registered",
          resourceTypes: ["managedEnvironments", "flexibleServers", "registries", "vaults"].map(
            (resourceType) => ({ resourceType, locations: ["East US 2"] }),
          ),
        })
      if (args[0] === "group" && args[1] === "exists") return "false"
      if (args[0] === "group" && args[1] === "create") throw interrupted
    }
    throw new Error(`Unexpected operation ${executable} ${args.join(" ")}`)
  })

  await expect(runWizard({ ui, run, path, directory, existing, session })).rejects.toBe(interrupted)

  expect(ui.confirm).toHaveBeenCalledOnce()
  expect(session.draft?.deploymentStarted).toBe(true)
  const persisted = JSON.parse(await readFile(session.path, "utf8"))
  expect(persisted).not.toHaveProperty("approval")
  expect(persisted.answers).not.toHaveProperty("approval")
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
  await session.close()
  const reopened = await openSession(path)
  sessions.push(reopened)
  events.length = 0
  run.mockClear()
  ui.confirm = vi.fn(async () => {
    events.push("approval")
    return false
  })

  await expect(
    runWizard({ ui, run, path, directory, existing, session: reopened }),
  ).rejects.toThrow(/cancel/i)

  expect(events.indexOf("notice:warning")).toBeGreaterThanOrEqual(0)
  expect(events.indexOf("checks")).toBeGreaterThan(events.indexOf("notice:warning"))
  expect(events.indexOf("approval")).toBeGreaterThan(events.lastIndexOf("source"))
  expect(run.mock.calls.some(([, args]) => args[0] === "account" && args[1] === "show")).toBe(true)
  expect(run.mock.calls.some(([executable]) => executable === "git")).toBe(true)
  expect(run.mock.calls.some(([, args]) => args[0] === "group" && args[1] === "create")).toBe(false)
  expect(ui.confirm).toHaveBeenCalledOnce()
  expect(ui.wait).not.toHaveBeenCalled()
  expect(ui.select).not.toHaveBeenCalled()
  expect(ui.cloud).not.toHaveBeenCalled()
  expect(ui.text).not.toHaveBeenCalled()
  expect(reopened.draft?.deploymentStarted).toBe(true)
  expect(JSON.parse(await readFile(reopened.path, "utf8"))).not.toHaveProperty("approval")
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
})

it.each(["invalid draft", "conflicting draft", "update with draft", "deployment without config"] as const)(
  "preserves %s before cloud discovery, checkpoints, or a destructive recovery menu",
  async (kind) => {
    const { directory, path, session } = await target()
    let active = session
    let existing: DeploymentConfig | undefined
    if (kind === "invalid draft") {
      await session.close()
      await writeFile(session.path, '{"version":', { mode: 0o600 })
      active = await openSession(path)
      sessions.push(active)
    } else {
      await session.answer("name", "team-hub")
      await session.answer("owner", kind === "conflicting draft" ? "other-team" : "platform-team")
      if (kind === "deployment without config") await session.phase("provision")
      else {
        existing = savedConfiguration()
        await writeFile(path, JSON.stringify(existing), { mode: 0o600 })
      }
    }
    const previous = await readFile(active.path, "utf8")
    const phase = vi.spyOn(active, "phase")
    const answer = vi.spyOn(active, "answer")
    const restart = vi.spyOn(active, "restart")
    const run = vi.fn<RunCommand>()
    const ui: WizardUI = {
      cloud: vi.fn(), text: vi.fn(), select: vi.fn(), confirm: vi.fn(),
      wait: vi.fn(), status: vi.fn(),
    }

    await expect(runWizard({
      ui, run, path, directory, session: active, existing, configureOnly: true,
      ...(kind === "update with draft" ? { entryAction: "update" as const } : {}),
    })).rejects.toThrow()

    expect(ui.select).not.toHaveBeenCalled()
    expect(ui.confirm).not.toHaveBeenCalled()
    expect(ui.cloud).not.toHaveBeenCalled()
    expect(phase).not.toHaveBeenCalled()
    expect(answer).not.toHaveBeenCalled()
    expect(restart).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(await readFile(active.path, "utf8")).toBe(previous)
    if (existing) expect(JSON.parse(await readFile(path, "utf8"))).toEqual(existing)
  },
)
