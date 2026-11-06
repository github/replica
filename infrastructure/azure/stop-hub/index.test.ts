import timers from "node:timers/promises"
import { expect, it, vi } from "vitest"

import { CommandExecutionError } from "../../installer/command/index.ts"
import { stopHub } from "./index.ts"

function option(args: string[], name: string) {
  return args[args.indexOf(name) + 1]
}

it.each(["synchronous", "asynchronous"])(
  "deactivates only active revisions and drains active and inactive replicas with a %s command adapter",
  async (adapter) => {
    const events: string[][] = []
    const remaining = new Map([
      ["hub-current", 1],
      ["hub-old", 2],
      ["hub-empty", 0],
    ])
    const sleep = vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)
    const execute = (...args: string[]) => {
      events.push(args)
      if (args.slice(0, 3).join(" ") === "containerapp revision list")
        return [
          { name: "hub-current", properties: { active: true } },
          { name: "hub-old", properties: { active: false } },
          { name: "hub-empty", properties: { active: true } },
        ]
      if (args[2] === "deactivate") return null
      if (args[1] === "replica") {
        const revision = option(args, "--revision")
        const count = remaining.get(revision)!
        remaining.set(revision, count - 1)
        return count > 0 ? [{ name: `${revision}-replica` }] : []
      }
      throw new Error(`Unexpected command ${args.join(" ")}`)
    }
    const command = vi.fn(
      adapter === "synchronous" ? execute : async (...args: string[]) => execute(...args),
    )

    await stopHub({ name: "test-hub-hub", resourceGroup: "test-group", command })

    const deactivations = events.filter((args) => args[2] === "deactivate")
    expect(deactivations.map((args) => option(args, "--revision"))).toEqual([
      "hub-current",
      "hub-empty",
    ])
    const replicaReads = events.filter((args) => args[1] === "replica")
    expect(replicaReads.map((args) => option(args, "--revision"))).toEqual([
      "hub-current",
      "hub-current",
      "hub-old",
      "hub-old",
      "hub-old",
      "hub-empty",
    ])
    expect(events.indexOf(replicaReads[0]!)).toBeGreaterThan(events.indexOf(deactivations.at(-1)!))
    for (const args of events) {
      expect(option(args, "--name")).toBe("test-hub-hub")
      expect(option(args, "--resource-group")).toBe("test-group")
    }
    expect(sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5_000, 5_000, 5_000])
    expect(
      events.some(
        (args) => args.includes("delete") || args.includes("activate") || args.includes("job"),
      ),
    ).toBe(false)
  },
)

it.each([
  { description: "a missing list", revisions: null },
  {
    description: "a missing activity flag",
    revisions: [
      { name: "hub-active", properties: { active: true } },
      { name: "hub-unknown", properties: {} },
    ],
  },
  {
    description: "a string activity flag",
    revisions: [
      { name: "hub-active", properties: { active: true } },
      { name: "hub-unknown", properties: { active: "false" } },
    ],
  },
  {
    description: "a missing revision name",
    revisions: [
      { name: "hub-active", properties: { active: true } },
      { properties: { active: false } },
    ],
  },
  {
    description: "an invalid revision name",
    revisions: [
      { name: "hub-active", properties: { active: true } },
      { name: "hub-unknown\nother", properties: { active: false } },
    ],
  },
])(
  "validates all revisions before deactivation when Azure returns $description",
  async ({ revisions }) => {
    const command = vi.fn(() => revisions)

    await expect(stopHub({ name: "hub", resourceGroup: "group", command })).rejects.toThrow(
      /revision|metadata/i,
    )

    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]).toEqual([
      "containerapp",
      "revision",
      "list",
      "--name",
      "hub",
      "--resource-group",
      "group",
    ])
  },
)

it("completes without deactivation or polling for an empty revision inventory", async () => {
  const command = vi.fn(() => [])
  const sleep = vi.spyOn(timers, "setTimeout").mockResolvedValue(undefined)

  await stopHub({ name: "hub", resourceGroup: "group", command })

  expect(command).toHaveBeenCalledTimes(1)
  expect(sleep).not.toHaveBeenCalled()
})

it.each(["deactivation", "replica inspection", "cancellation"])(
  "propagates %s failure without automatic activation or other recovery mutations",
  async (source) => {
    const failure =
      source === "cancellation"
        ? new CommandExecutionError("Cancelled", true)
        : new Error("Azure operation failed")
    const events: string[][] = []
    const command = vi.fn((...args: string[]) => {
      events.push(args)
      if (args[2] === "list" && args[1] === "revision")
        return [
          { name: "hub-first", properties: { active: true } },
          { name: "hub-second", properties: { active: true } },
        ]
      if (
        (source === "replica inspection" && args[1] === "replica") ||
        (source !== "replica inspection" && args[2] === "deactivate")
      )
        throw failure
      return null
    })

    await expect(stopHub({ name: "hub", resourceGroup: "group", command })).rejects.toBe(failure)

    expect(
      events.some(
        (args) =>
          args.includes("activate") ||
          args.includes("delete") ||
          args.includes("job") ||
          args.includes("lease"),
      ),
    ).toBe(false)
    if (source !== "replica inspection") expect(events).toHaveLength(2)
  },
)

it("does not interpret an unknown replica response as successful shutdown", async () => {
  const command = vi.fn((...args: string[]) =>
    args[1] === "revision"
      ? [{ name: "hub-old", properties: { active: false } }]
      : { replicas: [] },
  )

  await expect(stopHub({ name: "hub", resourceGroup: "group", command })).rejects.toThrow(
    /replica.*list|shutdown.*verif/i,
  )

  expect(command).toHaveBeenCalledTimes(2)
})

it("shares the five-minute drain deadline across active and inactive revisions", async () => {
  let now = 0
  vi.spyOn(performance, "now").mockImplementation(() => now)
  const sleep = vi.spyOn(timers, "setTimeout").mockImplementation(async () => {
    now += 5_000
  })
  const events: string[][] = []
  const command = vi.fn((...args: string[]) => {
    events.push(args)
    if (args[1] === "revision" && args[2] === "list")
      return [
        { name: "hub-current", properties: { active: true } },
        { name: "hub-old", properties: { active: false } },
      ]
    if (args[2] === "deactivate") return null
    if (option(args, "--revision") === "hub-current" && now >= 200_000) return []
    return [{ name: "still-running" }]
  })

  await expect(stopHub({ name: "hub", resourceGroup: "group", command })).rejects.toThrow(
    /replicas.*not stopped|timeout|maintenance/i,
  )

  expect(now).toBe(300_000)
  expect(sleep).toHaveBeenCalledTimes(60)
  expect(events.at(-1)).toContain("hub-old")
  expect(events.filter((args) => args[2] === "deactivate")).toHaveLength(1)
  expect(events.some((args) => args.includes("activate"))).toBe(false)
})
