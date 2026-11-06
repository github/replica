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

function scenario({ existing = false, release = false } = {}) {
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
  }
  const commands: string[][] = []
  const messages: string[] = []
  const choices: string[] = []
  const menus: string[][] = []
  let onSelect: ((value: string) => void) | undefined
  let onConfirm: (() => boolean) | undefined
  let onCommand: ((args: string[]) => void) | undefined
  let breakError: Error | undefined
  let acquireFailures = 0
  let afterBreak: (() => void) | undefined
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
    if (operation === "containerapp revision list")
      return JSON.stringify(evidence.revisions[option(args, "--name")!])
    if (operation === "containerapp replica list")
      return JSON.stringify(evidence.replicas[option(args, "--revision")!])
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
    notice: (_level, message) => messages.push(message),
    confirm: vi.fn(async (message: string) => {
      messages.push(message)
      return onConfirm?.() ?? true
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
    choices,
    menus,
    ui,
    acquire: () => acquireLease(context, target.account, target.container, target.blob),
    breaks: () =>
      commands.filter((args) => args.slice(0, 4).join(" ") === "storage blob lease break"),
    acquisitions: () =>
      commands.filter((args) => args.slice(0, 4).join(" ") === "storage blob lease acquire"),
    onSelect: (callback: (value: string) => void) => (onSelect = callback),
    onConfirm: (callback: () => boolean) => (onConfirm = callback),
    onCommand: (callback: (args: string[]) => void) => (onCommand = callback),
    failBreak: (error: Error) => (breakError = error),
    failAcquisition: () => (acquireFailures = 1),
    afterBreak: (callback: () => void) => (afterBreak = callback),
    unlock: () => (evidence.lease = unlocked()),
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
})

it("does not treat non-interactive deployment approval as permission to recover a lease", async () => {
  const s = scenario()
  delete s.ui.select

  await expect(s.acquire()).rejects.toThrow("Lease is still owned")

  expect(s.ui.confirm).not.toHaveBeenCalled()
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
    expect(s.breaks()).toHaveLength(0)
    expect(s.acquisitions()).toHaveLength(0)
  },
)

it("refuses to recover a release lock in a storage account owned by another installation", async () => {
  const s = scenario({ existing: true, release: true })
  s.evidence.accountTags.owner = "another-team"
  s.choices.push("recover", "retry", "exit")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.choices).toHaveLength(0)
  expect(s.ui.confirm).not.toHaveBeenCalled()
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
  const s = scenario()
  s.evidence.lease = lease
  s.choices.push("retry", "exit")

  await expect(s.acquire()).rejects.toThrow()

  expect(s.menus).toHaveLength(2)
  for (const menu of s.menus) {
    expect(menu).toEqual(expect.arrayContaining(["retry", "exit"]))
    expect(menu).not.toContain("recover")
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
