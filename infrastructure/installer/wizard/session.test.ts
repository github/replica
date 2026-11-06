import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setImmediate } from "node:timers/promises"
import { afterEach, expect, it, vi } from "vitest"

import { openSession } from "../session/index.ts"
import type { RunCommand, WizardPhase, WizardUI } from "../types.ts"
import { runWizard } from "./index.ts"

const directories: string[] = []
const sessions: Awaited<ReturnType<typeof openSession>>[] = []

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

it("resumes accepted answers after failure, rechecks Azure choices, and completes configuration without cloud mutation", async () => {
  const { directory, path, session } = await target()
  const tenantId = "00000000-0000-0000-0000-000000000001"
  const subscriptionId = "00000000-0000-0000-0000-000000000002"
  const interrupted = new Error("Synthetic questionnaire interruption")
  let region = { name: "eastus2", displayName: "East US 2" }
  let activeSession = session
  const completedPhases: WizardPhase[] = []
  const prerequisitePhases: (WizardPhase | undefined)[] = []
  const checkpointPhases: (WizardPhase | undefined)[] = []
  const first: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    field: vi.fn(async (field) => {
      if (field.id === "resourceGroup") throw interrupted
      return field.parse(field.id === "name" ? "team-hub" : "platform-team")
    }),
    text: vi.fn(async () => {
      throw new Error("Unexpected legacy text prompt")
    }),
    select: vi.fn<WizardUI["select"]>(async (_message, options) => options[0]!.value),
    confirm: vi.fn(async () => false),
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
      return JSON.stringify([region])
    }
    if (args[0] === "provider" && args[1] === "show") {
      return JSON.stringify({
        resourceTypes: ["managedEnvironments", "flexibleServers", "registries", "vaults"].map(
          (resourceType) => ({ resourceType, locations: [region.displayName] }),
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
  })
  await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  await session.close()
  activeSession = await openSession(path)
  sessions.push(activeSession)
  region = { name: "westus2", displayName: "West US 2" }
  completedPhases.length = 0
  prerequisitePhases.length = 0
  checkpointPhases.length = 0
  run.mockClear()
  const resumed: WizardUI = {
    ...first,
    welcome: vi.fn(),
    cloud: vi.fn(async () => "azure" as const),
    field: vi.fn(async (field) => {
      expect(field.id).toBe("resourceGroup")
      return field.parse("team-hub-rg")
    }),
    select: vi.fn<WizardUI["select"]>(async (_message, options) => {
      if (options.some(({ value }) => value === "resume")) {
        expect(options.map(({ value }) => value)).toEqual(
          expect.arrayContaining(["resume", "start-over", "exit"]),
        )
        return "resume"
      }
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
  expect(resumed.welcome).toHaveBeenCalledWith(true)
  expect(prerequisitePhases).toEqual(["checks"])
  expect(checkpointPhases).toEqual(["checks"])
  expect(resumed.field).toHaveBeenCalledOnce()
  expect(resumed.select).toHaveBeenCalledTimes(2)
  expect(run.mock.calls.some(([, args]) => args[0] === "account" && args[1] === "list")).toBe(true)
  expect(run.mock.calls.some(([, args]) => args[0] === "rest")).toBe(true)
  expect(run.mock.calls.filter(([, args]) => args[0] === "provider")).toHaveLength(4)
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    cloud: "azure",
    name: "team-hub",
    owner: "platform-team",
    azure: { tenantId, subscriptionId, location: "westus2", resourceGroup: "team-hub-rg" },
  })
  await expect(readFile(activeSession.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" })
})

it("requires a recovery acknowledgement for an interrupted deployment without reusing cloud approval", async () => {
  const { directory, path, session } = await target()
  await session.answer("cloud", "azure")
  await session.answer("name", "team-hub")
  await session.phase("provision")
  await session.close()
  const reopened = await openSession(path)
  sessions.push(reopened)
  const events: string[] = []
  const stop = new Error("Synthetic stop at fresh prerequisite checks")
  const ui: WizardUI = {
    cloud: vi.fn(async () => "azure" as const),
    text: vi.fn(),
    select: vi.fn(async () => "resume"),
    confirm: vi.fn(),
    wait: vi.fn(async () => {
      events.push("acknowledged")
    }),
    status: vi.fn(),
    notice: vi.fn((level) => {
      events.push(`notice:${level}`)
    }),
  }
  const run = vi.fn<RunCommand>(async (executable, args) => {
    events.push("checks")
    if (args[0] === "account" && args[1] === "list") throw stop
    if (executable === "terraform") return JSON.stringify({ terraform_version: "1.13.4" })
    return executable === "az" && args[0] === "version" ? "{}" : ""
  })

  await expect(runWizard({ ui, run, path, directory, session: reopened })).rejects.toBe(stop)

  expect(events.indexOf("notice:warning")).toBeGreaterThanOrEqual(0)
  expect(events.indexOf("acknowledged")).toBeGreaterThan(events.indexOf("notice:warning"))
  expect(events.indexOf("checks")).toBeGreaterThan(events.indexOf("acknowledged"))
  expect(ui.confirm).not.toHaveBeenCalled()
  expect(reopened.draft?.deploymentStarted).toBe(true)
  expect(await readFile(reopened.path, "utf8")).toContain('"deploymentStarted": true')
})

it.each(["exit", "start-over"])(
  "preserves the draft without cloud discovery when choosing %s without confirming a restart",
  async (choice) => {
    const { directory, path, session } = await target()
    await session.answer("name", "team-hub")
    await session.answer("owner", "platform-team")
    const previous = await readFile(session.path, "utf8")
    const run = vi.fn<RunCommand>()
    const ui: WizardUI = {
      cloud: vi.fn(),
      text: vi.fn(),
      select: vi.fn<WizardUI["select"]>(async (_message, options) => {
        expect(options.map(({ value }) => value)).toEqual(
          expect.arrayContaining(["resume", "start-over", "exit"]),
        )
        return "exit"
      }),
      confirm: vi.fn(async () => false),
      wait: vi.fn(),
      status: vi.fn(),
    }
    vi.mocked(ui.select).mockResolvedValueOnce(choice)

    await runWizard({ ui, run, path, directory, session, configureOnly: true }).catch(
      () => undefined,
    )

    expect(ui.select).toHaveBeenCalled()
    expect(ui.confirm).toHaveBeenCalledTimes(choice === "start-over" ? 1 : 0)
    expect(ui.cloud).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(await readFile(session.path, "utf8")).toBe(previous)
  },
)

it("restarts the local questionnaire only after confirmation and does not inherit the discarded answers", async () => {
  const { directory, path, session } = await target()
  await session.answer("name", "discarded-hub")
  await session.answer("owner", "discarded-team")
  const stop = new Error("Stop at the new cloud choice")
  const run = vi.fn<RunCommand>()
  const ui: WizardUI = {
    cloud: vi.fn(async () => {
      throw stop
    }),
    text: vi.fn(),
    select: vi.fn(async () => "start-over"),
    confirm: vi.fn(async () => true),
    wait: vi.fn(),
    status: vi.fn(),
  }

  await expect(runWizard({ ui, run, path, directory, session, configureOnly: true })).rejects.toBe(
    stop,
  )

  expect(ui.confirm).toHaveBeenCalledOnce()
  expect(ui.cloud).toHaveBeenCalledOnce()
  expect(session.draft?.answers.name).toBeUndefined()
  expect(session.draft?.answers.owner).toBeUndefined()
  expect(run).not.toHaveBeenCalled()
})
