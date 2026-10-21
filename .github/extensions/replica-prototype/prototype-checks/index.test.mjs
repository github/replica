import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { setTimeout } from "node:timers/promises"

import { createPrototypeChecks } from "./index.mjs"
import { createPrivateStore } from "../private-store/index.mjs"
import { createChecksSnapshot } from "../checks-snapshot/index.mjs"

function input(fingerprint = "one") {
  return {
    state: "ready",
    fingerprint,
    branch: "prototype",
    head: "a".repeat(40),
    base: "b".repeat(40),
    baseline: { branch: "prototype", ref: "main", sha: "b".repeat(40) },
    pages: [{ id: "page", name: "Page", route: "/page", inputs: ["page.tsx"] }],
    unknown: [],
    pageFiles: { page: ["page.tsx"] },
    files: new Map([["page.tsx", Buffer.from("source")]]),
    config: {
      base: "main",
      concurrency: 1,
      checks: [
        {
          id: "lint",
          name: "Lint",
          runner: { type: "command" },
          criteria: [{ id: "clean" }],
        },
        {
          id: "review",
          name: "Review",
          runner: { type: "agent", instructions: "review.md" },
          criteria: [{ id: "clean" }],
        },
        {
          id: "advice",
          name: "Advice",
          runner: { type: "agent", instructions: "review.md" },
          criteria: [{ id: "clean" }],
        },
      ],
    },
  }
}

function editedInput(fingerprint = "two") {
  const snapshot = input(fingerprint)
  snapshot.files.set("page.tsx", Buffer.from(`edited source ${fingerprint}`))
  return snapshot
}

function result(check, snapshot) {
  const reader = createChecksSnapshot(snapshot, snapshot.pages)
  reader.read({ file: "page.tsx" })
  return {
    version: 2,
    checkId: check.id,
    fingerprint: snapshot.fingerprint,
    outcome: check.id === "review" ? "fail" : "pass",
    summary: "Observed fixture.",
    criteria: [
      {
        id: "clean",
        status: check.id === "review" ? "fail" : "pass",
        evidence: "Observed fixture.",
      },
    ],
    findings: [],
    ...(check.runner.type === "agent" ? { readCoverage: reader.coverage() } : {}),
  }
}

async function fixture(test, options = {}) {
  const { session = foregroundSession(), ...managerOptions } = options
  const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-manager-"))
  const checks = createPrototypeChecks(
    { repositoryPath: root, sessionWorkspacePath: root },
    session,
    {
      isolated: true,
      poll: false,
      capture: async () => input(),
      runner: result,
      ...managerOptions,
    },
  )
  test.after(async () => {
    await checks.close()
    await rm(root, { recursive: true, force: true })
  })
  return checks
}

function foregroundSession(processing = false) {
  const handlers = new Set()
  return {
    send: async () => {
      assert.fail("Automatic scheduling must not send foreground prompts.")
    },
    log: () => {},
    rpc: { metadata: { isProcessing: async () => ({ processing }) } },
    on(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    emit(type, extra = {}) {
      for (const handler of handlers) handler({ type, ...extra })
    },
    get subscriptions() {
      return handlers.size
    },
  }
}

async function settled(checks) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await checks.action("status")
    if (!state.checks.some((check) => ["queued", "running"].includes(check.status))) return state
    await setTimeout(5)
  }
  throw new Error("Checks did not settle.")
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return
    await setTimeout(5)
  }
  throw new Error("Expected worker state was not reached.")
}

describe("createPrototypeChecks()", () => {
  it("retains completed assessments across unrelated commits and config edits without rewriting run identity", async (test) => {
    let snapshot = input()
    snapshot.config.checks[0].inputs = { include: ["page.tsx"] }
    const checks = await fixture(test, { capture: async () => snapshot })
    await checks.action("run", { checkIds: ["lint"] })
    const completed = (await settled(checks)).checks[0]
    snapshot = structuredClone(snapshot)
    snapshot.fingerprint = "unrelated-commit"
    snapshot.head = "c".repeat(40)
    snapshot.base = "d".repeat(40)
    snapshot.files.set("README.md", Buffer.from("Unrelated documentation"))
    snapshot.config.concurrency = 3
    snapshot.config.debounceMs = 8000
    snapshot.config.checks[0].automatic = true
    snapshot.config.checks[1].criteria[0].name = "Changed sibling"
    const current = (await checks.action("status")).checks[0]
    assert.equal(current.status, "completed")
    assert.equal(current.outcome, "pass")
    assert.equal(current.runId, completed.runId)
    assert.equal(current.fingerprint, "one")
    assert.equal(typeof current.assessmentFingerprint, "string")
    assert.equal(current.assessmentFingerprint, completed.assessmentFingerprint)
    snapshot.files.set("page.tsx", Buffer.from("Relevant edit"))
    snapshot.fingerprint = "relevant-edit"
    assert.equal((await checks.action("status")).checks[0].status, "out_of_date")
  })

  it("keeps in-flight work and deduplicates manual requests when only sibling inputs change", async (test) => {
    let snapshot = input()
    snapshot.config.checks[0].inputs = { include: ["page.tsx"] }
    const completion = Promise.withResolvers()
    let signal
    let calls = 0
    test.after(() => completion.resolve())
    const checks = await fixture(test, {
      capture: async () => snapshot,
      runner: async (check, captured, options) => {
        calls++
        signal = options.signal
        await completion.promise
        return result(check, captured)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await waitFor(() => signal)
    snapshot = structuredClone(snapshot)
    snapshot.fingerprint = "sibling-edit"
    snapshot.files.set("sibling.ts", Buffer.from("Changed sibling source"))
    snapshot.config.checks[1].timeoutSeconds = 60
    const state = await checks.action("run", { checkIds: ["lint"] })
    assert.equal(state.checks[0].status, "running")
    assert.equal(signal.aborted, false)
    completion.resolve()
    const complete = await settled(checks)
    assert.equal(calls, 1)
    assert.equal(complete.checks[0].outcome, "pass")
    assert.equal(complete.checks[0].fingerprint, "one")
  })

  it("aborts work on a branch switch even when assessment bytes are identical", async (test) => {
    let snapshot = input()
    const completion = Promise.withResolvers()
    let signal
    test.after(() => completion.resolve())
    const checks = await fixture(test, {
      capture: async () => snapshot,
      runner: async (check, captured, options) => {
        signal = options.signal
        await completion.promise
        return result(check, captured)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await waitFor(() => signal)
    snapshot = { ...snapshot, branch: "another-prototype" }
    assert.equal((await checks.action("status")).checks[0].status, "out_of_date")
    assert.equal(signal.aborted, true)
    completion.resolve()
    assert.equal((await settled(checks)).checks[0].outcome, null)
  })

  it("coalesces queued revisions and waits for the same check's obsolete worker cleanup", async (test) => {
    let snapshot = input()
    snapshot.config.concurrency = 2
    const oldCompletion = Promise.withResolvers()
    const newCompletion = Promise.withResolvers()
    const calls = []
    test.after(() => {
      oldCompletion.resolve()
      newCompletion.resolve()
    })
    const checks = await fixture(test, {
      capture: async () => snapshot,
      runner: async (check, captured, { signal }) => {
        calls.push({ fingerprint: captured.fingerprint, signal })
        await (captured.fingerprint === "one" ? oldCompletion.promise : newCompletion.promise)
        return result(check, captured)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await waitFor(() => calls.length === 1)
    snapshot = editedInput("two")
    snapshot.config.concurrency = 2
    await checks.action("run", { checkIds: ["lint"] })
    assert.equal(calls[0].signal.aborted, true)
    assert.equal(calls.length, 1)
    snapshot = editedInput("three")
    snapshot.config.concurrency = 2
    const latest = await checks.action("run", { checkIds: ["lint"] })
    await checks.action("run", { checkIds: ["lint"] })
    assert.equal(calls.length, 1)
    oldCompletion.resolve()
    await waitFor(() => calls.length === 2)
    assert.equal(calls[1].fingerprint, "three")
    assert.equal((await checks.action("status")).checks[0].runId, latest.checks[0].runId)
    newCompletion.resolve()
    const state = await settled(checks)
    assert.equal(state.checks[0].runId, latest.checks[0].runId)
    assert.equal(state.checks[0].fingerprint, "three")
    assert.equal(state.checks[0].outcome, "pass")
    assert.equal(calls.length, 2)
  })

  it("projects configured criterion names without changing assessment evidence or outcome", async (test) => {
    const snapshot = input()
    snapshot.config.checks[0].criteria[0].name = "No lint diagnostics"
    const checks = await fixture(test, { capture: async () => snapshot })
    await checks.action("run", { checkIds: ["lint"] })
    const state = await settled(checks)
    assert.equal(state.checks[0].criteria[0].name, "No lint diagnostics")
    assert.equal(state.checks[0].criteria[0].evidence, "Observed fixture.")
    assert.equal(state.checks[0].outcome, "pass")
    assert.equal(state.checks[0].summary, "Observed fixture.")
    assert.equal(state.checks[0].runner, "command")
    for (const field of ["score", "scoreState", "lastComplete"]) assert.equal(field in state, false)
    for (const field of ["score", "weight"]) assert.equal(field in state.checks[0], false)
  })

  it("keeps completed failures separate from execution errors and includes every manual check", async (test) => {
    const checks = await fixture(test)
    await checks.action("run", { checkIds: ["lint"] })
    assert.equal((await settled(checks)).checks[0].outcome, "pass")
    await checks.action("run", { checkIds: ["review"] })
    const complete = await settled(checks)
    assert.equal(complete.checks[1].status, "completed")
    assert.equal(complete.checks[1].outcome, "fail")
    assert.equal(complete.checks.find((check) => check.id === "advice").status, "not_run")
    assert.equal(complete.checks[2].outcome, null)
  })
  it("completes repository-wide checks without pages and preserves semantic uncertainty", async (test) => {
    const snapshot = input()
    snapshot.pages = []
    const checks = await fixture(test, {
      capture: async () => snapshot,
      runner: (check, current) => ({
        ...result(check, current),
        outcome: "unverified",
        summary: "Rendered behavior still needs verification.",
      }),
    })
    await checks.action("run", { checkIds: ["lint"] })
    const state = await settled(checks)
    assert.equal(state.checks[0].status, "completed")
    assert.equal(state.checks[0].outcome, "unverified")
    assert.equal(state.checks[0].summary, "Rendered behavior still needs verification.")
    assert.ok(!state.checks[0].error)
    assert.deepEqual(state.pages, [])
  })
  it("marks saved results out of date after edits and never accepts obsolete late completions", async (test) => {
    let current = input()
    let finish
    const checks = await fixture(test, {
      capture: async () => current,
      runner: (check, snapshot) =>
        new Promise((resolve) => {
          finish = () => resolve(result(check, snapshot))
        }),
    })
    await checks.action("run", { checkIds: ["lint"] })
    while (!finish) await setTimeout(5)
    current = editedInput()
    const state = await checks.action("status")
    assert.equal(state.checks[0].status, "out_of_date")
    finish()
    assert.equal((await settled(checks)).checks[0].outcome, null)
  })
  it("surfaces execution errors rather than converting them to assessment failures", async (test) => {
    const checks = await fixture(test, {
      runner: async () => {
        throw new Error("Browser unavailable")
      },
    })
    await checks.action("run", { checkIds: ["review"] })
    const state = await settled(checks)
    assert.equal(state.checks[1].status, "execution_error")
    assert.equal(state.checks[1].outcome, null)
    assert.match(state.checks[1].error, /Browser unavailable/)
  })
  it("cancels owned work and rejects stale fix handoffs", async (test) => {
    const checks = await fixture(test, {
      runner: async (check, snapshot, { signal }) => {
        await setTimeout(1000, undefined, { signal })
        return result(check, snapshot)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await checks.action("cancel", { checkIds: ["lint"] })
    assert.equal((await settled(checks)).checks[0].status, "cancelled")
    await assert.rejects(
      checks.action("fix", {
        checkId: "lint",
        runId: "old",
        findingIds: ["finding"],
      }),
      /out of date/,
    )
  })
  it("never displays an outcome from a result arriving after cancellation", async (test) => {
    const checks = await fixture(test, {
      runner: async (check, snapshot) => {
        await setTimeout(20)
        return result(check, snapshot)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await checks.action("cancel", { checkIds: ["lint"] })
    const state = await settled(checks)
    assert.equal(state.checks[0].status, "cancelled")
    assert.equal(state.checks[0].outcome, null)
    assert.deepEqual(state.checks[0].findings, [])
  })
  it("hands only current selected findings to the foreground and deduplicates identical requests", async (test) => {
    const prompts = []
    let snapshot = input()
    snapshot.config.checks[1].inputs = { include: ["page.tsx"] }
    const checks = await fixture(test, {
      capture: async () => snapshot,
      session: { send: async (message) => prompts.push(message) },
      runner: (check, snapshot) => ({
        ...result(check, snapshot),
        findings: [
          {
            id: "issue",
            severity: "error",
            pageId: "page",
            criterionId: "clean",
            title: "Observed issue",
            description: "Fix the observed fixture.",
            evidence: "page.tsx evidence",
            file: "page.tsx",
          },
          {
            id: "unselected",
            severity: "warning",
            pageId: "page",
            criterionId: "clean",
            title: "Leave this alone",
            description: "Not requested.",
            evidence: "Another observation",
          },
        ],
      }),
    })
    await checks.action("run", { checkIds: ["review"] })
    const state = await settled(checks)
    assert.equal(prompts.length, 0)
    const selection = {
      checkId: "review",
      runId: state.checks[1].runId,
      findingIds: ["issue"],
    }
    snapshot = structuredClone(snapshot)
    snapshot.fingerprint = "unrelated"
    snapshot.files.set("README.md", Buffer.from("Unrelated edit"))
    await checks.action("fix", selection)
    await checks.action("fix", selection)
    assert.equal(prompts.length, 1)
    assert.match(prompts[0].prompt, /user explicitly requested/)
    assert.match(prompts[0].prompt, /Observed issue/)
    assert.doesNotMatch(prompts[0].prompt, /Leave this alone/)
    await checks.action("run", { checkIds: ["review"] })
    const rerun = await settled(checks)
    await assert.rejects(checks.action("fix", selection), /out of date/)
    snapshot.files.set("page.tsx", Buffer.from("Relevant edit"))
    snapshot.fingerprint = "relevant"
    await assert.rejects(
      checks.action("fix", { ...selection, runId: rerun.checks[1].runId }),
      /out of date/,
    )
    assert.equal(prompts.length, 1)
  })
  it("runs missing opted-in checks after an idle bootstrap and does not repeat current assessments", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    let snapshot = input()
    snapshot.config.checks[0].automatic = true
    let calls = 0
    const checks = await fixture(test, {
      poll: true,
      capture: async () => snapshot,
      runner: (check, current) => {
        calls++
        return result(check, current)
      },
    })
    await checks.action("status")
    assert.equal(calls, 0)
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.equal(calls, 1)
    snapshot = editedInput()
    snapshot.config.checks[0].automatic = true
    await checks.action("status")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.equal(calls, 2)
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.equal(calls, 2)
  })
  it("waits for root idle and the latest relevant edit while ignoring subagents and turn end", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession(true)
    let snapshot = input()
    snapshot.config.checks[0].automatic = true
    snapshot.config.debounceMs = 4000
    const calls = []
    const checks = await fixture(test, {
      session,
      poll: true,
      capture: async () => snapshot,
      runner: (check, current) => {
        calls.push(current.fingerprint)
        return result(check, current)
      },
    })
    await checks.action("status")
    snapshot = editedInput("intermediate")
    snapshot.config.checks[0].automatic = true
    snapshot.config.debounceMs = 4000
    await checks.action("status")
    session.emit("assistant.idle", { agentId: "child" })
    session.emit("session.idle", { data: { parentToolCallId: "legacy-child" } })
    session.emit("assistant.turn_end")
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.deepEqual(calls, [])
    snapshot = editedInput("busy-latest")
    snapshot.config.checks[0].automatic = true
    snapshot.config.debounceMs = 4000
    await checks.action("status")
    session.emit("assistant.idle")
    test.mock.timers.tick(2000)
    await checks.action("status")
    snapshot = editedInput("latest")
    snapshot.config.checks[0].automatic = true
    snapshot.config.debounceMs = 4000
    await checks.action("status")
    session.emit("user.message", { agentId: "child" })
    session.emit("assistant.turn_start", { data: { parentToolCallId: "legacy-child" } })
    test.mock.timers.tick(2000)
    await checks.action("status")
    assert.deepEqual(calls, [])
    session.emit("session.idle")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.deepEqual(calls, ["latest"])
  })

  it("does not let a stale idle bootstrap override a newer foreground busy event", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession()
    const bootstrap = Promise.withResolvers()
    session.rpc.metadata.isProcessing = () => {
      assert.equal(session.subscriptions, 1)
      session.emit("user.message")
      return bootstrap.promise
    }
    const snapshot = input()
    snapshot.config.checks[0].automatic = true
    let calls = 0
    const checks = await fixture(test, {
      session,
      poll: true,
      capture: async () => snapshot,
      runner: (check, current) => {
        calls++
        return result(check, current)
      },
    })
    const opening = checks.action("status")
    await waitFor(() => session.subscriptions === 1)
    bootstrap.resolve({ processing: false })
    await opening
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.equal(calls, 0)
    session.emit("session.idle")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.equal(calls, 1)
  })

  it("retries unknown activity without repeated warnings and still permits manual checks", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession()
    const warnings = []
    session.log = (message) => warnings.push(message)
    let queries = 0
    let available = false
    session.rpc.metadata.isProcessing = async () => {
      queries++
      if (!available) throw new Error("Activity unavailable")
      return { processing: false }
    }
    const snapshot = input()
    snapshot.config.checks[0].automatic = true
    const calls = []
    const checks = await fixture(test, {
      session,
      poll: true,
      capture: async () => snapshot,
      runner: (check, current) => {
        calls.push(check.id)
        return result(check, current)
      },
    })
    await checks.action("status")
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.deepEqual(calls, [])
    assert.ok(queries >= 2)
    assert.equal(warnings.length, 1)
    await checks.action("run", { checkIds: ["advice"] })
    await settled(checks)
    assert.deepEqual(calls, ["advice"])
    available = true
    await checks.action("status")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.deepEqual(calls, ["advice", "lint"])
  })

  it("allows a root idle event to unblock scheduling when the activity RPC is missing", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession()
    delete session.rpc
    const warnings = []
    session.log = (message) => warnings.push(message)
    const snapshot = input()
    snapshot.config.checks[0].automatic = true
    let calls = 0
    const checks = await fixture(test, {
      session,
      poll: true,
      capture: async () => snapshot,
      runner: (check, current) => {
        calls++
        return result(check, current)
      },
    })
    await checks.action("status")
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.equal(calls, 0)
    assert.equal(warnings.length, 1)
    session.emit("assistant.idle")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.equal(calls, 1)
  })

  it("holds queued automatic work through foreground activity but allows manual work and preserves running checks", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession()
    const snapshot = input()
    snapshot.config.checks[1].automatic = true
    snapshot.config.debounceMs = 4000
    const completion = Promise.withResolvers()
    test.after(() => completion.resolve())
    const calls = []
    const checks = await fixture(test, {
      session,
      poll: true,
      capture: async () => snapshot,
      runner: async (check, current, { signal }) => {
        calls.push({ id: check.id, signal })
        if (check.id === "lint") await completion.promise
        return result(check, current)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await waitFor(() => calls.length === 1)
    test.mock.timers.tick(4000)
    const queued = await checks.action("status")
    assert.equal(queued.checks[1].status, "queued")
    session.emit("assistant.turn_start")
    assert.equal(calls[0].signal.aborted, false)
    completion.resolve()
    await checks.action("run", { checkIds: ["advice"] })
    await waitFor(() => calls.some((call) => call.id === "advice"))
    assert.deepEqual(
      calls.map((call) => call.id),
      ["lint", "advice"],
    )
    assert.equal((await checks.action("status")).checks[1].status, "queued")
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.equal(calls.length, 2)
    session.emit("assistant.idle")
    test.mock.timers.tick(2000)
    await checks.action("status")
    assert.equal(calls.length, 2)
    session.emit("assistant.idle")
    test.mock.timers.tick(2000)
    await checks.action("status")
    const complete = await settled(checks)
    assert.deepEqual(
      calls.map((call) => call.id),
      ["lint", "advice", "review"],
    )
    assert.equal(complete.checks[1].runId, queued.checks[1].runId)
    assert.equal(complete.checks[1].fingerprint, "one")
  })

  it("promotes a queued automatic assessment on explicit Run without changing its identity or duplicating work", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession()
    const snapshot = input()
    snapshot.config.checks[1].automatic = true
    const completion = Promise.withResolvers()
    test.after(() => completion.resolve())
    const calls = []
    const checks = await fixture(test, {
      session,
      poll: true,
      capture: async () => snapshot,
      runner: async (check, current) => {
        calls.push(check.id)
        if (check.id === "lint") await completion.promise
        return result(check, current)
      },
    })
    await checks.action("run", { checkIds: ["lint"] })
    await waitFor(() => calls.length === 1)
    test.mock.timers.tick(2000)
    const queued = (await checks.action("status")).checks[1]
    assert.equal(queued.status, "queued")
    assert.equal(queued.trigger, "automatic")
    session.emit("user.message")
    const promoted = (await checks.action("run", { checkIds: ["review"] })).checks[1]
    assert.equal(promoted.runId, queued.runId)
    assert.equal(promoted.trigger, "manual")
    assert.equal(
      (await checks.action("run", { checkIds: ["review"] })).checks[1].runId,
      queued.runId,
    )
    completion.resolve()
    const complete = await settled(checks)
    assert.deepEqual(calls, ["lint", "review"])
    assert.equal(complete.checks[1].runId, queued.runId)
    assert.equal(complete.checks[1].fingerprint, "one")
    assert.equal(complete.checks[1].outcome, "fail")
  })

  it("keeps a shared manager subscribed until the last canvas closes and stops further polling", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const session = foregroundSession(true)
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-lifecycle-"))
    const context = { repositoryPath: root, sessionWorkspacePath: root }
    const snapshot = input()
    snapshot.config.checks[0].automatic = true
    let captures = 0
    let calls = 0
    const options = {
      capture: async () => {
        captures++
        return snapshot
      },
      runner: (check, current) => {
        calls++
        return result(check, current)
      },
    }
    const first = createPrototypeChecks(context, session, options)
    const second = createPrototypeChecks(context, session, options)
    test.after(async () => {
      await first.close()
      await second.close()
      await rm(root, { recursive: true, force: true })
    })
    await first.action("status")
    assert.equal(session.subscriptions, 1)
    await first.close()
    assert.equal(session.subscriptions, 1)
    session.emit("session.idle")
    test.mock.timers.tick(2000)
    await second.action("status")
    await settled(second)
    assert.equal(calls, 1)
    snapshot.files.set("page.tsx", Buffer.from("Edit before closing"))
    snapshot.fingerprint = "closing-edit"
    await second.action("status")
    await second.close()
    assert.equal(session.subscriptions, 0)
    const capturedBeforeClose = captures
    session.emit("session.idle")
    test.mock.timers.tick(10000)
    await setTimeout(10)
    assert.equal(captures, capturedBeforeClose)
    assert.equal(calls, 1)
  })

  it("debounces each automatic check independently instead of resetting siblings' quiet periods", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    let snapshot = input()
    snapshot.files.set("sibling.ts", Buffer.from("Sibling source"))
    snapshot.config.checks = snapshot.config.checks.slice(0, 2).map((check, index) => ({
      ...check,
      automatic: true,
      inputs: { include: [index === 0 ? "page.tsx" : "sibling.ts"] },
      runner: { type: "command" },
    }))
    const calls = []
    const checks = await fixture(test, {
      poll: true,
      capture: async () => snapshot,
      runner: (check, current) => {
        calls.push(check.id)
        return result(check, current)
      },
    })
    await checks.action("run", { checkIds: ["lint", "review"] })
    await settled(checks)
    calls.length = 0
    test.mock.timers.tick(1000)
    snapshot = structuredClone(snapshot)
    snapshot.fingerprint = "lint-edit"
    snapshot.files.set("page.tsx", Buffer.from("Lint edit"))
    await checks.action("status")
    test.mock.timers.tick(1000)
    await checks.action("status")
    test.mock.timers.tick(1000)
    snapshot = structuredClone(snapshot)
    snapshot.fingerprint = "sibling-edit"
    snapshot.files.set("sibling.ts", Buffer.from("Sibling edit"))
    await checks.action("status")
    test.mock.timers.tick(1000)
    await checks.action("status")
    await settled(checks)
    assert.deepEqual(calls, ["lint"])
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.deepEqual(calls, ["lint", "review"])
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.deepEqual(calls, ["lint", "review"])
  })

  it("reruns a reverted automatic assessment without reviving its obsolete worker", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    let snapshot = input()
    snapshot.config.checks[0].automatic = true
    const assessmentA = editedInput("assessment-a")
    assessmentA.config.checks[0].automatic = true
    const oldCompletion = Promise.withResolvers()
    const newCompletion = Promise.withResolvers()
    const calls = []
    test.after(() => {
      oldCompletion.resolve()
      newCompletion.resolve()
    })
    const checks = await fixture(test, {
      poll: true,
      capture: async () => snapshot,
      runner: async (check, captured, { signal }) => {
        calls.push({ fingerprint: captured.fingerprint, signal })
        await (calls.length === 1 ? oldCompletion.promise : newCompletion.promise)
        return result(check, captured)
      },
    })
    await checks.action("status")
    snapshot = assessmentA
    await checks.action("status")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await waitFor(() => calls.length === 1)
    const originalRun = (await checks.action("status")).checks[0].runId
    snapshot = editedInput("assessment-b")
    snapshot.config.checks[0].automatic = true
    await checks.action("status")
    assert.equal(calls[0].signal.aborted, true)
    test.mock.timers.tick(1000)
    snapshot = structuredClone(assessmentA)
    snapshot.fingerprint = "assessment-a-returned"
    const reverted = await checks.action("status")
    assert.equal(reverted.checks[0].status, "out_of_date")
    assert.equal(reverted.checks[0].outcome, null)
    test.mock.timers.tick(1000)
    await checks.action("status")
    assert.equal(calls.length, 1)
    test.mock.timers.tick(2000)
    const queued = await checks.action("status")
    assert.equal(queued.checks[0].status, "queued")
    assert.notEqual(queued.checks[0].runId, originalRun)
    assert.equal(calls.length, 1)
    oldCompletion.resolve()
    await waitFor(() => calls.length === 2)
    assert.deepEqual(
      calls.map((call) => call.fingerprint),
      ["assessment-a", "assessment-a-returned"],
    )
    const running = await checks.action("status")
    assert.equal(running.checks[0].status, "running")
    assert.equal(running.checks[0].runId, queued.checks[0].runId)
    assert.equal(running.checks[0].outcome, null)
    newCompletion.resolve()
    const complete = await settled(checks)
    assert.equal(complete.checks[0].status, "completed")
    assert.equal(complete.checks[0].outcome, "pass")
    assert.equal(complete.checks[0].runId, queued.checks[0].runId)
    assert.equal(complete.checks[0].fingerprint, "assessment-a-returned")
  })

  for (const terminal of ["pass", "fail", "unverified", "execution_error", "cancelled"]) {
    it(`does not automatically retry a current ${terminal} assessment but permits manual retry`, async (test) => {
      test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
      let snapshot = input()
      snapshot.config.checks[0].automatic = true
      snapshot.config.checks[0].inputs = { include: ["page.tsx"] }
      let calls = 0
      const checks = await fixture(test, {
        poll: true,
        capture: async () => snapshot,
        runner: async (check, current, { signal }) => {
          calls++
          if (terminal === "execution_error") throw new Error("Runner unavailable")
          if (terminal === "cancelled") await setTimeout(1000, undefined, { signal })
          return {
            ...result(check, current),
            outcome: terminal === "cancelled" ? "pass" : terminal,
          }
        },
      })
      await checks.action("run", { checkIds: ["lint"] })
      if (terminal === "cancelled") {
        await waitFor(() => calls === 1)
        await checks.action("cancel", { checkIds: ["lint"] })
      }
      const completed = await settled(checks)
      assert.equal(
        completed.checks[0].status,
        ["execution_error", "cancelled"].includes(terminal) ? terminal : "completed",
      )
      snapshot = structuredClone(snapshot)
      snapshot.fingerprint = "unrelated-edit"
      snapshot.files.set("README.md", Buffer.from("Unrelated edit"))
      await checks.action("status")
      test.mock.timers.tick(10000)
      await checks.action("status")
      await settled(checks)
      assert.equal(calls, 1)
      await checks.action("run", { checkIds: ["lint"] })
      await waitFor(() => calls === 2)
      if (terminal === "cancelled") await checks.action("cancel", { checkIds: ["lint"] })
      await settled(checks)
      assert.equal(calls, 2)
    })
  }

  it("catches up only eligible missing and outdated assessments after reopening, not saved terminal or interrupted work", async (test) => {
    test.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 })
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-catch-up-"))
    const context = { repositoryPath: root, sessionWorkspacePath: root }
    const snapshot = input()
    const ids = [
      "pass",
      "fail",
      "unverified",
      "execution-error",
      "cancelled",
      "interrupted",
      "outdated",
    ]
    snapshot.config.checks = ids.map((id) => ({
      ...snapshot.config.checks[0],
      id,
      automatic: true,
      inputs: { include: [id === "outdated" ? "outdated.ts" : "page.tsx"] },
    }))
    snapshot.files.set("outdated.ts", Buffer.from("Original"))
    const options = {
      isolated: true,
      poll: false,
      capture: async () => snapshot,
      runner: (check, current) => ({
        ...result(check, current),
        outcome: ["fail", "unverified"].includes(check.id) ? check.id : "pass",
      }),
    }
    const first = createPrototypeChecks(context, foregroundSession(true), options)
    let second
    test.after(async () => {
      await first.close()
      await second?.close()
      await rm(root, { recursive: true, force: true })
    })
    await first.action("run")
    await settled(first)
    await first.close()
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    const saved = await store.read("results.json")
    for (const id of ["execution-error", "cancelled"]) {
      saved.records[id].status = id === "execution-error" ? "execution_error" : id
      saved.records[id].result = null
    }
    saved.records.interrupted.status = "queued"
    saved.records.interrupted.ownerPid = 2147483647
    saved.records.interrupted.result = null
    await store.write("results.json", saved)
    snapshot.files.set("outdated.ts", Buffer.from("Edited"))
    snapshot.fingerprint = "reopened"
    snapshot.config.checks.push(
      { ...snapshot.config.checks[0], id: "missing" },
      { ...snapshot.config.checks[0], id: "manual", automatic: false },
      { ...snapshot.config.checks[0], id: "unrelated-page", targets: ["other"] },
    )
    const calls = []
    second = createPrototypeChecks(context, foregroundSession(), {
      ...options,
      poll: true,
      runner: (check, current) => {
        calls.push(check.id)
        return result(check, current)
      },
    })
    const opened = await second.action("status")
    assert.equal(opened.state, "ready", opened.error)
    assert.equal(
      opened.checks.find((check) => check.id === "interrupted").status,
      "execution_error",
    )
    snapshot.state = "scope_required"
    await second.action("status")
    test.mock.timers.tick(2000)
    await second.action("status")
    assert.deepEqual(calls, [])
    snapshot.state = "ready"
    await second.action("status")
    test.mock.timers.tick(2000)
    await second.action("status")
    const complete = await settled(second)
    assert.deepEqual(calls.sort(), ["missing", "outdated"])
    for (const id of ["pass", "fail", "unverified"]) {
      const restored = complete.checks.find((check) => check.id === id)
      assert.equal(restored.outcome, id)
      assert.equal(restored.runId, saved.records[id].runId)
      assert.equal(restored.fingerprint, "one")
    }
    for (const id of ["execution-error", "cancelled", "interrupted"])
      assert.equal(complete.checks.find((check) => check.id === id).runId, saved.records[id].runId)
    assert.equal(complete.checks.find((check) => check.id === "manual").status, "not_run")
    assert.equal(
      complete.checks.find((check) => check.id === "unrelated-page").status,
      "not_applicable",
    )
    await second.action("run", { checkIds: ["interrupted"] })
    await settled(second)
    assert.ok(calls.includes("interrupted"))
  })

  it("restores complete results and their pinned baseline after provider restart", async (test) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-restart-"))
    test.after(() => rm(root, { recursive: true, force: true }))
    const context = { repositoryPath: root, sessionWorkspacePath: root }
    const session = { send: async () => {} }
    const options = {
      isolated: true,
      poll: false,
      capture: async () => input(),
      runner: result,
    }
    const first = createPrototypeChecks(context, session, options)
    await first.action("run", { checkIds: ["lint", "review"] })
    assert.equal((await settled(first)).checks[1].outcome, "fail")
    await first.close()
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    const saved = await store.read("results.json")
    assert.equal(saved.version, 3)
    assert.equal(saved.records.lint.fingerprint, "one")
    assert.equal(saved.records.lint.result.fingerprint, "one")
    assert.equal(typeof saved.records.lint.assessmentFingerprint, "string")
    assert.equal(saved.records.lint.branch, "prototype")
    assert.equal(saved.records.lint.head, input().head)
    assert.equal(saved.records.lint.base, input().base)
    const second = createPrototypeChecks(context, session, {
      ...options,
      capture: async (directory, baselines) => {
        assert.deepEqual(baselines["prototype:main"], input().baseline)
        const current = input("new-head")
        current.head = "c".repeat(40)
        return current
      },
    })
    test.after(() => second.close())
    const restored = await second.action("status")
    assert.equal(restored.checks[0].outcome, "pass")
    assert.equal(restored.checks[1].outcome, "fail")
    assert.equal(restored.checks[0].fingerprint, "one")
    assert.equal(restored.checks[0].assessmentFingerprint, saved.records.lint.assessmentFingerprint)
    const persisted = await store.read("results.json")
    assert.equal(persisted.records.lint.result.fingerprint, "one")
    assert.equal(persisted.records.lint.fingerprint, "one")
    assert.deepEqual(
      (await second.action("status")).checks[1].readCoverage,
      result(input().config.checks[1], input()).readCoverage,
    )
  })
  it("migrates legacy result bodies without losing baseline, scope selection or job metadata", async (test) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-migration-"))
    const context = { repositoryPath: root, sessionWorkspacePath: root }
    const options = { isolated: true, poll: false, capture: async () => input(), runner: result }
    const first = createPrototypeChecks(context, {}, options)
    let second
    test.after(async () => {
      await first.close()
      await second?.close()
      await rm(root, { recursive: true, force: true })
    })
    await first.action("run", { checkIds: ["lint"] })
    await settled(first)
    await first.close()
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    const saved = await store.read("results.json")
    const metadata = {
      runId: saved.records.lint.runId,
      ownerPid: saved.records.lint.ownerPid,
      runner: saved.records.lint.runner,
      requestedAt: saved.records.lint.requestedAt,
      startedAt: saved.records.lint.startedAt,
      finishedAt: saved.records.lint.finishedAt,
      trigger: saved.records.lint.trigger,
    }
    saved.version = 1
    saved.selection = { key: "saved-scope", pageIds: ["page"] }
    saved.lastComplete = { score: 100, branch: "prototype", checkedAt: "2026-10-07T12:00:00Z" }
    saved.records.lint.result = {
      version: 1,
      checkId: "lint",
      fingerprint: "one",
      score: 100,
      criteria: [{ id: "clean", pageId: "page", status: "pass", evidence: "Legacy evidence." }],
      findings: [],
    }
    await store.write("results.json", saved)
    second = createPrototypeChecks(
      context,
      {},
      {
        ...options,
        capture: async (directory, baselines, selection) => {
          assert.deepEqual(baselines["prototype:main"], input().baseline)
          assert.deepEqual(selection, saved.selection)
          return input()
        },
      },
    )
    const state = await second.action("status")
    assert.equal(state.state, "ready")
    assert.equal(state.checks[0].status, "out_of_date")
    assert.equal(state.checks[0].outcome, null)
    assert.deepEqual(state.checks[0].findings, [])
    assert.equal("lastComplete" in state, false)
    const migrated = await store.read("results.json")
    assert.equal(migrated.version, 3)
    assert.equal("lastComplete" in migrated, false)
    assert.equal(migrated.records.lint.result, null)
    for (const [field, value] of Object.entries(metadata))
      assert.equal(migrated.records.lint[field], value)
  })
  it("loads version 2 reports but invalidates records without assessment identity or provenance", async (test) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-v2-migration-"))
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    await store.write("results.json", {
      version: 2,
      baselines: { "prototype:main": input().baseline },
      selection: null,
      records: {
        lint: {
          runId: "12345678-1234-1234-1234-123456789abc",
          ownerPid: process.pid,
          runner: "command",
          fingerprint: "one",
          status: "completed",
          result: result(input().config.checks[0], input()),
        },
      },
    })
    const checks = createPrototypeChecks(
      { repositoryPath: root, sessionWorkspacePath: root },
      {},
      { isolated: true, poll: false, capture: async () => input(), runner: result },
    )
    test.after(async () => {
      await checks.close()
      await rm(root, { recursive: true, force: true })
    })
    const state = await checks.action("status")
    assert.equal(state.state, "ready")
    assert.equal(state.checks[0].status, "out_of_date")
    assert.equal(state.checks[0].outcome, null)
    assert.equal((await store.read("results.json")).version, 3)
  })

  it("rejects saved reports rebound to a newer run fingerprint despite matching assessment content", async (test) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-result-identity-"))
    const context = { repositoryPath: root, sessionWorkspacePath: root }
    const options = { isolated: true, poll: false, capture: async () => input(), runner: result }
    const first = createPrototypeChecks(context, {}, options)
    let second
    test.after(async () => {
      await first.close()
      await second?.close()
      await rm(root, { recursive: true, force: true })
    })
    await first.action("run", { checkIds: ["lint"] })
    await settled(first)
    await first.close()
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    const saved = await store.read("results.json")
    saved.records.lint.result.fingerprint = "new-head"
    await store.write("results.json", saved)
    second = createPrototypeChecks(
      context,
      {},
      {
        ...options,
        capture: async () => input("new-head"),
      },
    )
    const state = await second.action("status")
    assert.equal(state.state, "error")
    assert.ok(state.error)
    assert.ok(!state.checks.some((check) => check.outcome))
  })
  it("checks active legacy ownership before discarding incompatible result bodies", async (test) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-owned-migration-"))
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    const record = {
      runId: "12345678-1234-1234-1234-123456789abc",
      ownerPid: process.pid,
      runner: "command",
      fingerprint: "one",
      status: "running",
      result: { version: 1, checkId: "lint", fingerprint: "one", criteria: [], findings: [] },
    }
    await store.write("results.json", {
      version: 1,
      baselines: { "prototype:main": input().baseline },
      selection: null,
      records: { lint: record },
    })
    const checks = createPrototypeChecks(
      { repositoryPath: root, sessionWorkspacePath: root },
      {},
      { isolated: true, poll: false, capture: async () => input(), runner: result },
    )
    test.after(async () => {
      await checks.close()
      await rm(root, { recursive: true, force: true })
    })
    const state = await checks.action("status")
    assert.equal(state.state, "error")
    assert.match(state.error, /active|alive|provider/i)
    assert.deepEqual((await store.read("results.json")).records.lint, record)
  })
  it("withholds corrupted saved results and preserves validated pins on explicit reset", async (test) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "replica-check-invalid-state-"))
    let first
    let second
    test.after(async () => {
      await first?.close()
      await second?.close()
      await rm(root, { recursive: true, force: true })
    })
    const context = { repositoryPath: root, sessionWorkspacePath: root }
    const session = { send: async () => {} }
    const options = { isolated: true, poll: false, capture: async () => input(), runner: result }
    first = createPrototypeChecks(context, session, options)
    await first.action("run", { checkIds: ["lint"] })
    await settled(first)
    await first.close()
    const key = createHash("sha256").update(`${root}\0${root}`).digest("hex")
    const store = createPrivateStore(path.join(root, "replica-checks", key))
    const saved = await store.read("results.json")
    saved.records.lint.result.criteria = []
    await store.write("results.json", saved)
    second = createPrototypeChecks(context, session, options)
    const blocked = await second.action("status")
    assert.equal(blocked.state, "error")
    assert.equal(blocked.checks[0].outcome, null)
    assert.ok(blocked.error)
    const reset = await second.action("reset")
    assert.equal(reset.state, "ready")
    assert.equal(reset.checks[0].outcome, null)
    assert.equal(reset.checks[0].status, "not_run")
    assert.deepEqual(
      (await store.read("results.json")).baselines["prototype:main"],
      input().baseline,
    )
  })
})
