import assert from "node:assert/strict"
import { afterEach, it, mock } from "node:test"
import timers from "node:timers/promises"

import { stopHub } from "./index.ts"

afterEach(() => {
  mock.restoreAll()
})

function option(args: string[], name: string) {
  return args[args.indexOf(name) + 1]
}

for (const adapter of ["synchronous", "asynchronous"]) {
  it(`deactivates only active revisions and drains active and inactive replicas with a ${adapter} command adapter`, async () => {
    const events: string[][] = []
    const remaining = new Map([
      ["hub-current", 1],
      ["hub-old", 2],
      ["hub-empty", 0],
    ])
    const sleep = mock.method(timers, "setTimeout", async () => undefined)
    const execute = (...args: string[]) => {
      events.push(args)
      if (args.slice(0, 3).join(" ") === "containerapp revision list") {
        const revisions = [
          { name: "hub-current", properties: { active: true } },
          { name: "hub-old", properties: { active: false } },
          { name: "hub-empty", properties: { active: true } },
        ]
        return args.includes("--all")
          ? revisions
          : revisions.filter((revision) => revision.properties.active)
      }
      if (args[2] === "deactivate") return null
      if (args[1] === "replica") {
        const revision = option(args, "--revision")
        const count = remaining.get(revision)!
        remaining.set(revision, count - 1)
        return count > 0 ? [{ name: `${revision}-replica` }] : []
      }
      throw new Error(`Unexpected command ${args.join(" ")}`)
    }
    const command =
      adapter === "synchronous" ? execute : async (...args: string[]) => execute(...args)

    await stopHub({ name: "test-hub-hub", resourceGroup: "test-group", command })

    const deactivations = events.filter((args) => args[2] === "deactivate")
    assert.deepEqual(
      deactivations.map((args) => option(args, "--revision")),
      ["hub-current", "hub-empty"],
    )
    const replicaReads = events.filter((args) => args[1] === "replica")
    assert.deepEqual(
      replicaReads.map((args) => option(args, "--revision")),
      ["hub-current", "hub-current", "hub-old", "hub-old", "hub-old", "hub-empty"],
    )
    assert.ok(events.indexOf(replicaReads[0]!) > events.indexOf(deactivations.at(-1)!))
    for (const args of events) {
      assert.equal(option(args, "--name"), "test-hub-hub")
      assert.equal(option(args, "--resource-group"), "test-group")
    }
    assert.deepEqual(
      sleep.mock.calls.map(({ arguments: [milliseconds] }) => milliseconds),
      [5_000, 5_000, 5_000],
    )
    assert.equal(
      events.some(
        (args) => args.includes("delete") || args.includes("activate") || args.includes("job"),
      ),
      false,
    )
  })
}

for (const { description, revisions } of [
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
]) {
  it(`validates all revisions before deactivation when Azure returns ${description}`, async () => {
    const command = mock.fn(() => revisions)

    await assert.rejects(
      stopHub({ name: "hub", resourceGroup: "group", command }),
      /revision|metadata/i,
    )

    assert.equal(command.mock.callCount(), 1)
    assert.deepEqual(
      command.mock.calls[0].arguments.filter((arg) => arg !== "--all"),
      ["containerapp", "revision", "list", "--name", "hub", "--resource-group", "group"],
    )
  })
}

it("completes without deactivation or polling for an empty revision inventory", async () => {
  const command = mock.fn(() => [])
  const sleep = mock.method(timers, "setTimeout", async () => undefined)

  await stopHub({ name: "hub", resourceGroup: "group", command })

  assert.equal(command.mock.callCount(), 1)
  assert.equal(sleep.mock.callCount(), 0)
})

for (const source of ["deactivation", "replica inspection", "cancellation"]) {
  it(`propagates ${source} failure without automatic activation or other recovery mutations`, async () => {
    const failure =
      source === "cancellation"
        ? Object.assign(new Error("Cancelled"), { cancelled: true })
        : new Error("Azure operation failed")
    const events: string[][] = []
    const command = mock.fn((...args: string[]) => {
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

    await assert.rejects(
      stopHub({ name: "hub", resourceGroup: "group", command }),
      (error: unknown) => error === failure,
    )

    assert.equal(
      events.some(
        (args) =>
          args.includes("activate") ||
          args.includes("delete") ||
          args.includes("job") ||
          args.includes("lease"),
      ),
      false,
    )
    if (source !== "replica inspection") assert.equal(events.length, 2)
  })
}

it("does not interpret an unknown replica response as successful shutdown", async () => {
  const command = mock.fn((...args: string[]) =>
    args[1] === "revision"
      ? [{ name: "hub-old", properties: { active: false } }]
      : { replicas: [] },
  )

  await assert.rejects(
    stopHub({ name: "hub", resourceGroup: "group", command }),
    /replica.*list|shutdown.*verif/i,
  )

  assert.equal(command.mock.callCount(), 2)
})

it("shares the five-minute drain deadline across active and inactive revisions", async () => {
  let now = 0
  mock.method(performance, "now", () => now)
  const sleep = mock.method(timers, "setTimeout", async () => {
    now += 5_000
  })
  const events: string[][] = []
  const command = mock.fn((...args: string[]) => {
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

  await assert.rejects(
    stopHub({ name: "hub", resourceGroup: "group", command }),
    /replicas.*not stopped|timeout|maintenance/i,
  )

  assert.equal(now, 300_000)
  assert.equal(sleep.mock.callCount(), 60)
  assert.ok(events.at(-1)?.includes("hub-old"))
  assert.equal(events.filter((args) => args[2] === "deactivate").length, 1)
  assert.equal(
    events.some((args) => args.includes("activate")),
    false,
  )
})

for (const elapsed of [300_000, 305_000]) {
  it(`accepts a drained final revision after ${elapsed} milliseconds of the shared budget`, async () => {
    let now = 0
    mock.method(performance, "now", () => now)
    const sleep = mock.method(timers, "setTimeout", async () => undefined)
    const inspected: string[] = []
    const command = (...args: string[]) => {
      if (args[1] === "revision")
        return [
          { name: "hub-first", properties: { active: false } },
          { name: "hub-last", properties: { active: false } },
        ]
      const revision = option(args, "--revision")
      inspected.push(revision)
      now += revision === "hub-first" ? 200_000 : elapsed - 200_000
      return []
    }

    await stopHub({ name: "hub", resourceGroup: "group", command })

    assert.deepEqual(inspected, ["hub-first", "hub-last"])
    assert.equal(now, elapsed)
    assert.equal(sleep.mock.callCount(), 0)
  })
}
