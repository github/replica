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
  const { session = { send: async () => {}, log: () => {} }, ...managerOptions } = options
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

async function settled(checks) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await checks.action("status")
    if (!state.checks.some((check) => ["queued", "running"].includes(check.status))) return state
    await setTimeout(5)
  }
  throw new Error("Checks did not settle.")
}

describe("createPrototypeChecks()", () => {
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
    current = input("two")
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
    const checks = await fixture(test, {
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
    await checks.action("fix", selection)
    await checks.action("fix", selection)
    assert.equal(prompts.length, 1)
    assert.match(prompts[0].prompt, /user explicitly requested/)
    assert.match(prompts[0].prompt, /Observed issue/)
    assert.doesNotMatch(prompts[0].prompt, /Leave this alone/)
  })
  it("debounces opted-in saved edits without running on open or repeatedly retrying the same inputs", async (test) => {
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
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.equal(calls, 0)
    snapshot = input("two")
    snapshot.config.checks[0].automatic = true
    await checks.action("status")
    test.mock.timers.tick(2000)
    await checks.action("status")
    await settled(checks)
    assert.equal(calls, 1)
    test.mock.timers.tick(10000)
    await checks.action("status")
    assert.equal(calls, 1)
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
    const second = createPrototypeChecks(context, session, {
      ...options,
      capture: async (directory, baselines) => {
        assert.deepEqual(baselines["prototype:main"], input().baseline)
        return input()
      },
    })
    test.after(() => second.close())
    const restored = await second.action("status")
    assert.equal(restored.checks[0].outcome, "pass")
    assert.equal(restored.checks[1].outcome, "fail")
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
    assert.equal(migrated.version, 2)
    assert.equal("lastComplete" in migrated, false)
    assert.equal(migrated.records.lint.result, null)
    for (const [field, value] of Object.entries(metadata))
      assert.equal(migrated.records.lint[field], value)
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
