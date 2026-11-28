import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import { designer, weekOneLog, weekTwoLog } from "../conformance/index.mjs"
import { createRecurrenceConsolidator } from "../src/consolidators/recurrence.mjs"
import { labelComments } from "../src/labeling.mjs"
import { LearningError } from "../src/errors.mjs"
import { createInMemoryProvider } from "../src/providers/in-memory.mjs"
import { createLearningStore } from "../src/store.mjs"

const SCOPE = { repository: "acme/checkout-prototypes" }
const COPILOT = { scope: SCOPE, principal: { kind: "agent", id: "agent:copilot" } }

async function storeWith({ withdraw = false, log = weekOneLog() } = {}) {
  const store = await createLearningStore({
    provider: createInMemoryProvider(),
    clock: () => Date.parse("2026-10-09T12:00:00Z"),
  })
  const grant = await store.addGrant(designer(), {
    purposes: ["review", "instruction"],
    sources: ["hub_review_comments"],
    basis: "A Hub administrator turned on Learnings.",
  })
  await store.importHubReviewComments(COPILOT, log, { grantIds: [grant.id] })
  if (withdraw)
    await store.withdrawGrant(designer(), grant.id, {
      purposes: ["review"],
      reason: "A Hub administrator turned off Learnings.",
    })
  return store
}

/** A labeler that labels every comment it is asked about with one theme, and remembers requests. */
function fakeLabeler({ label = () => ({}), usage = [] } = {}) {
  const requests = []
  return {
    requests,
    manifest: { id: "copilot", name: "Copilot", version: "test" },
    async label(request) {
      requests.push(structuredClone(request))
      const asked = request.threads.flatMap((thread) =>
        thread.comments.filter((comment) => comment.label),
      )
      return {
        labels: asked.map((comment) => ({
          comment: comment.id,
          theme: {
            key: "visible-form-labels",
            statement: "Show a visible label above every field.",
          },
          signal: "accessibility",
          observation: "observed",
          stance: "supports",
          ...label(comment),
        })),
        usage,
      }
    },
  }
}

/** A labeler that labels only comments that mention labels, and leaves the rest unlabeled. */
function pickyLabeler() {
  const labeler = fakeLabeler()
  const label = labeler.label
  labeler.label = async (request) => {
    const answer = await label(request)
    const texts = new Map(
      request.threads.flatMap((thread) => thread.comments).map((item) => [item.id, item.text]),
    )
    return {
      ...answer,
      labels: answer.labels.filter((item) => /label/i.test(texts.get(item.comment))),
    }
  }
  return labeler
}

async function labelsBy(store, actorId) {
  const { events } = await store.queryObservations(designer(), { purpose: "review" })
  return events.filter((event) => event.type === "annotation" && event.actor.id === actorId)
}

/** A collection log whose comments are long enough that labeling them takes several requests. */
function lengthened(value) {
  if (Array.isArray(value)) return value.map(lengthened)
  if (!value || typeof value !== "object") return value
  const copy = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, lengthened(item)]),
  )
  if (typeof copy.body === "string") copy.body += ` ${"It needs more detail here. ".repeat(80)}`
  return copy
}

describe("labelComments()", () => {
  it("rounds fractional SDK usage across labeling, failures and the public CLI", async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "replica-copilot-usage-"))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    cpSync(new URL("../src", import.meta.url), path.join(directory, "src"), { recursive: true })
    cpSync(new URL("../package.json", import.meta.url), path.join(directory, "package.json"))
    const sdkDirectory = path.join(directory, "node_modules", "@github", "copilot-sdk")
    mkdirSync(sdkDirectory, { recursive: true })
    writeFileSync(
      path.join(sdkDirectory, "package.json"),
      JSON.stringify({ name: "@github/copilot-sdk", type: "module", exports: "./index.mjs" }),
    )
    writeFileSync(
      path.join(sdkDirectory, "index.mjs"),
      `export class CopilotClient {
        static requests = 0
        static failure = null
        async start() {}
        async stop() {}
        async getAuthStatus() { return { isAuthenticated: true } }
        async createSession() {
          let emit
          return {
            on(callback) { emit = callback; return () => {} },
            async disconnect() {},
            async sendAndWait({ prompt }) {
              CopilotClient.requests++
              emit({
                type: "assistant.usage",
                data: {
                  model: "fractional-test",
                  inputTokens: 10.25,
                  outputTokens: 5.75,
                  copilotUsage: { totalNanoAiu: 42.5 }
                }
              })
              emit({
                type: "assistant.usage",
                data: {
                  model: "fractional-test",
                  inputTokens: 0,
                  outputTokens: 0,
                  copilotUsage: { totalNanoAiu: 0.125 }
                }
              })
              if (CopilotClient.failure === "request") throw new Error("Synthetic service failure.")
              if (CopilotClient.failure === "reply") return { themes: [] }
              const { threads } = JSON.parse(prompt.slice(prompt.indexOf("\\n\\n") + 2))
              return { labels: threads.flatMap(thread => thread.comments)
                .filter(comment => comment.label)
                .map(comment => ({
                  comment: comment.id,
                  themeKey: "visible-form-labels",
                  statement: "Show a visible label above every field.",
                  signal: "accessibility",
                  observation: "observed",
                  stance: "supports"
                })) }
            }
          }
        }
      }`,
    )
    const { createCopilotLabeler } = await import(
      pathToFileURL(path.join(directory, "src", "labelers", "copilot.mjs"))
    )
    const sdk = await import(pathToFileURL(path.join(sdkDirectory, "index.mjs")))
    const labeler = createCopilotLabeler({ token: "synthetic-copilot-token" })
    t.after(() => labeler.close())
    const store = await storeWith()

    const result = await labelComments(store, COPILOT, { labeler, maxRequests: 1 })

    const expectedUsage = {
      requests: 2,
      inputTokens: 11,
      outputTokens: 6,
      nanoAiu: 44,
    }
    assert.deepEqual(result.usage, expectedUsage)
    assert.ok(result.labeled > 0)
    assert.equal(result.labeled, result.considered)
    assert.equal(result.remaining, 0)
    assert.equal((await labelsBy(store, COPILOT.principal.id)).length, result.labeled)
    assert.equal((await labelComments(store, COPILOT, { labeler, maxRequests: 1 })).considered, 0)
    assert.equal(
      sdk.CopilotClient.requests,
      1,
      "completed comments must not be sent and charged again",
    )

    for (const failure of ["request", "reply"]) {
      sdk.CopilotClient.failure = failure
      const failedStore = await storeWith()
      await assert.rejects(
        labelComments(failedStore, COPILOT, { labeler, maxRequests: 1 }),
        (error) => {
          assert.equal(error.code, "unavailable")
          assert.deepEqual(error.details.labelingResult.usage, expectedUsage)
          assert.equal(error.details.labelingResult.labeled, 0)
          assert.ok(error.details.labelingResult.remaining > 0)
          return true
        },
      )
      assert.equal((await labelsBy(failedStore, COPILOT.principal.id)).length, 0)
    }
    sdk.CopilotClient.failure = null
    const { main } = await import(pathToFileURL(path.join(directory, "src", "cli.mjs")))
    const dataDirectory = path.join(directory, "store")
    const log = path.join(directory, "reviews.json")
    writeFileSync(log, JSON.stringify(weekOneLog()))
    async function cli(...argv) {
      let output = ""
      let errors = ""
      const code = await main(
        [
          ...argv,
          "--dir",
          dataDirectory,
          "--repository",
          "github.com/repositories/123456",
          "--legacy-repository",
          "github.com/acme/checkout-prototypes",
          "--json",
        ],
        {
          cwd: directory,
          env: { COPILOT_GITHUB_TOKEN: "synthetic-copilot-token" },
          clock: () => Date.parse("2026-10-09T12:00:00Z"),
          stdout: {
            write: (text) => {
              output += text
            },
          },
          stderr: {
            write: (text) => {
              errors += text
            },
          },
        },
      )
      assert.equal(code, 0, errors)
      return JSON.parse(output)
    }
    const grant = await cli(
      "grants",
      "add",
      "--purpose",
      "review",
      "--purpose",
      "instruction",
      "--basis",
      "Synthetic SDK usage regression.",
      "--by",
      "github:ana-designer",
    )
    await cli("import", "hub-comments", log, "--grant", grant.id, "--actor", "agent:copilot")
    const report = await cli("label", "--max-requests", "1")
    assert.deepEqual(report.usage, expectedUsage)
    assert.equal(report.labeled, result.labeled)
    assert.equal(report.remaining, 0)
    assert.equal((await cli("label", "--max-requests", "1")).considered, 0)
    assert.equal(sdk.CopilotClient.requests, 4, "the CLI must not bill completed comments again")
  })

  it("caps labeler invocations without marking skipped groups and resumes on the next call", async () => {
    const log = weekOneLog()
    for (const call of log.calls)
      for (const root of call.result.threads ?? (call.result.thread ? [call.result.thread] : [])) {
        root.body = "Long design feedback. ".repeat(120)
        for (const reply of root.replies) reply.body = "Long reply feedback. ".repeat(120)
      }
    const store = await storeWith({ log })
    const labeler = fakeLabeler({
      usage: [
        { model: "test-model", inputTokens: 10, outputTokens: 5, nanoAiu: 20 },
        { model: "test-model", inputTokens: 2, outputTokens: 1, nanoAiu: 3 },
      ],
    })
    const first = await labelComments(store, COPILOT, { labeler, limit: 400, maxRequests: 1 })
    assert.equal(labeler.requests.length, 1)
    const asked = labeler.requests[0].threads.flatMap((thread) =>
      thread.comments.filter((comment) => comment.label).map((comment) => comment.id),
    )
    assert.equal(first.considered, asked.length)
    assert.equal(first.labeled, asked.length)
    assert.ok(first.remaining > 0)
    assert.equal(first.usage.requests, 2, "usage events are not labeler invocation counts")
    assert.equal(first.usage.nanoAiu, 23)
    const stored = await store.queryObservations(designer(), { purpose: "review" })
    const marked = stored.events.filter(
      (event) =>
        ["annotation", "no_annotation"].includes(event.type) &&
        event.actor.id === COPILOT.principal.id,
    )
    assert.deepEqual(new Set(marked.map((event) => event.parentEventId)), new Set(asked))
    const resumed = fakeLabeler()
    const second = await labelComments(store, COPILOT, { labeler: resumed, maxRequests: 1 })
    assert.equal(resumed.requests.length, 1)
    assert.equal(second.considered + second.remaining, first.remaining)
    for (const thread of resumed.requests[0].threads)
      for (const comment of thread.comments)
        if (comment.label) assert.ok(!asked.includes(comment.id))
  })

  it("keeps uncapped multi-group labeling as the default", async () => {
    const log = weekOneLog()
    for (const call of log.calls)
      for (const root of call.result.threads ?? (call.result.thread ? [call.result.thread] : [])) {
        root.body = "Long design feedback. ".repeat(120)
        for (const reply of root.replies) reply.body = "Long reply feedback. ".repeat(120)
      }
    const store = await storeWith({ log })
    const labeler = fakeLabeler()
    const result = await labelComments(store, COPILOT, { labeler })
    assert.ok(labeler.requests.length > 1)
    assert.equal(result.remaining, 0)
    assert.equal(result.considered, result.labeled)
  })

  it("refuses malformed request caps before any reads, writes, or model calls", async () => {
    const labeler = fakeLabeler()
    const store = { queryObservations: () => assert.fail("read before validation") }
    for (const maxRequests of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null])
      await assert.rejects(labelComments(store, COPILOT, { labeler, maxRequests }), {
        code: "invalid_input",
      })
    assert.equal(labeler.requests.length, 0)
  })

  it("retains completed usage and leaves the failed group retryable on a later request error", async () => {
    const log = weekOneLog()
    for (const call of log.calls)
      for (const root of call.result.threads ?? (call.result.thread ? [call.result.thread] : [])) {
        root.body = "Long design feedback. ".repeat(120)
        for (const reply of root.replies) reply.body = "Long reply feedback. ".repeat(120)
      }
    const store = await storeWith({ log })
    const usage = [{ model: "test-model", inputTokens: 100, outputTokens: 10, nanoAiu: 25 }]
    const labeler = fakeLabeler({ usage })
    const original = labeler.label
    let calls = 0
    labeler.label = async (request) => {
      if (++calls === 2) throw new LearningError("unauthorized", "Connection revoked.")
      return original(request)
    }
    let partial
    await assert.rejects(labelComments(store, COPILOT, { labeler }), (error) => {
      assert.equal(error.code, "unauthorized")
      partial = error.details.labelingResult
      assert.equal(partial.usage.nanoAiu, 25)
      assert.equal(partial.usage.requests, 1)
      assert.equal(partial.events.length, partial.labeled)
      assert.ok(partial.remaining > 0)
      return true
    })
    const retry = fakeLabeler()
    const completed = await labelComments(store, COPILOT, { labeler: retry, maxRequests: 1 })
    assert.equal(completed.considered, partial.remaining)
    assert.equal(completed.remaining, 0)
  })

  it("preserves the original refusal and prior usage when the failed request reports malformed usage", async () => {
    const store = await storeWith({ log: lengthened(weekOneLog()) })
    const labeler = fakeLabeler({
      usage: [{ model: "test-model", inputTokens: 100, outputTokens: 10, nanoAiu: 25 }],
    })
    const label = labeler.label
    let requests = 0
    labeler.label = async (request) => {
      if (++requests === 2)
        throw new LearningError("unauthorized", "Connection revoked.", {
          usage: [{ model: "test-model", nanoAiu: 1.5 }],
        })
      return label(request)
    }

    await assert.rejects(labelComments(store, COPILOT, { labeler }), (error) => {
      assert.equal(error.code, "unauthorized")
      assert.equal(error.message, "Connection revoked.")
      const result = error.details.labelingResult
      assert.deepEqual(result.usage, {
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        nanoAiu: 25,
      })
      assert.match(result.usageError, /usage.*unknown/i)
      assert.ok(result.labeled > 0)
      assert.ok(result.remaining > 0)
      return true
    })
  })

  it("does not replace a refusal with validation errors for malformed failure usage shapes", async () => {
    for (const usage of ["invalid", [null], [1], [[1]], Array(1)]) {
      const store = await storeWith()
      await assert.rejects(
        labelComments(store, COPILOT, {
          labeler: {
            async label() {
              throw new LearningError("unauthorized", "Connection revoked.", { usage })
            },
          },
        }),
        (error) => {
          assert.equal(error.code, "unauthorized")
          assert.equal(error.message, "Connection revoked.")
          assert.match(error.details.labelingResult.usageError, /usage.*unknown/i)
          assert.equal(error.details.labelingResult.usage.requests, 0)
          assert.equal(error.details.labelingResult.usage.nanoAiu, 0)
          return true
        },
      )
    }
  })

  it("reports already-returned usage when persistence fails and does not mark skipped comments", async () => {
    const store = await storeWith()
    const usage = [{ model: "test-model", inputTokens: 100, outputTokens: 10, nanoAiu: 25 }]
    const labeler = fakeLabeler({ usage })
    const wrapper = {
      queryObservations: (...args) => store.queryObservations(...args),
      annotate: async () => {
        throw new LearningError("storage_corrupt", "Write failed.")
      },
      recordNoAnnotation: () => assert.fail("must not mark failed labels as processed"),
    }
    await assert.rejects(labelComments(wrapper, COPILOT, { labeler, maxRequests: 1 }), (error) => {
      assert.equal(error.code, "storage_corrupt")
      assert.equal(error.details.labelingResult.usage.nanoAiu, 25)
      assert.equal(error.details.labelingResult.labeled, 0)
      assert.equal(error.details.labelingResult.remaining, error.details.labelingResult.considered)
      return true
    })
    assert.equal((await labelsBy(store, COPILOT.principal.id)).length, 0)
  })

  it("retains service-reported usage on a failing request without inventing usage", async () => {
    const store = await storeWith()
    const usage = [{ model: "test-model", inputTokens: 7, outputTokens: 2, nanoAiu: 11 }]
    await assert.rejects(
      labelComments(store, COPILOT, {
        maxRequests: 1,
        labeler: {
          label: async () => {
            throw new LearningError("unavailable", "Invalid reply.", { usage })
          },
        },
      }),
      (error) => {
        assert.equal(error.details.labelingResult.usage.nanoAiu, 11)
        assert.equal(error.details.labelingResult.usage.requests, 1)
        assert.deepEqual(error.details.labelingResult.events, [])
        return true
      },
    )
  })

  it("uses the same retracted-comment filter when reconciling a failed request", async () => {
    const store = await storeWith()
    const observations = await store.queryObservations(COPILOT, { purpose: "review" })
    const comments = observations.events.filter((event) => event.type === "human_comment")
    const events = [
      ...observations.events,
      {
        type: "retraction",
        parentEventId: comments[0].id,
        id: "ev_retractedtest1",
      },
    ]
    const wrapper = { queryObservations: async () => ({ ...observations, events }) }
    await assert.rejects(
      labelComments(wrapper, COPILOT, {
        labeler: {
          label: async () => {
            throw new LearningError("unavailable", "Request failed.")
          },
        },
      }),
      (error) => {
        assert.equal(error.code, "unavailable")
        assert.equal(error.details.labelingResult.considered, comments.length - 1)
        assert.equal(error.details.labelingResult.remaining, comments.length - 1)
        return true
      },
    )
  })

  it("normalizes non-Error request failures without losing partial reporting", async () => {
    for (const thrown of [null, undefined, "Request failed.", 17, Object.create(null)]) {
      const store = await storeWith()
      await assert.rejects(
        labelComments(store, COPILOT, {
          labeler: {
            label: async () => {
              throw thrown
            },
          },
        }),
        (error) => {
          assert.equal(error.code, "unavailable")
          assert.equal(
            error.message,
            typeof thrown === "object" && thrown !== null
              ? "The labeler failed with a non-Error value."
              : String(thrown),
          )
          assert.equal(error.details.labelingResult.usage.requests, 0)
          assert.deepEqual(error.details.labelingResult.events, [])
          assert.ok(error.details.labelingResult.considered > 0)
          assert.equal(
            error.details.labelingResult.remaining,
            error.details.labelingResult.considered,
          )
          return true
        },
      )
    }
  })

  it("normalizes a non-Error reconciliation failure and preserves the request failure", async () => {
    const store = await storeWith()
    let reads = 0
    const wrapper = {
      queryObservations: async (...args) => {
        if (++reads > 1) throw undefined
        return store.queryObservations(...args)
      },
    }
    await assert.rejects(
      labelComments(wrapper, COPILOT, {
        labeler: {
          label: async () => {
            throw new LearningError("unauthorized", "Connection revoked.")
          },
        },
      }),
      (error) => {
        assert.equal(error.code, "unauthorized")
        assert.equal(error.message, "Connection revoked.")
        assert.equal(typeof error.details.labelingResult.progressError, "string")
        assert.equal(error.details.labelingResult.usage.requests, 0)
        return true
      },
    )
  })

  it("asks about comments in their threads without saying who wrote them", async () => {
    const store = await storeWith()
    const labeler = fakeLabeler()
    await labelComments(store, COPILOT, { labeler })
    const [request] = labeler.requests
    const comments = request.threads.flatMap((thread) => thread.comments)
    assert.ok(comments.length > 0)
    for (const comment of comments) {
      assert.deepEqual(
        Object.keys(comment).filter(
          (key) => !["id", "label", "text", "page", "element"].includes(key),
        ),
        [],
      )
      assert.doesNotMatch(JSON.stringify(comment), /github:|login|avatar/)
    }
    assert.deepEqual(request.themes, [])
  })

  it("asks nothing once review consent is withdrawn", async () => {
    const store = await storeWith({ withdraw: true })
    const labeler = fakeLabeler()
    const result = await labelComments(store, COPILOT, { labeler })
    assert.equal(labeler.requests.length, 0)
    assert.equal(result.considered, 0)
  })

  it("records each label as the labeler's judgment with the model it used", async () => {
    const store = await storeWith()
    const usage = [{ model: "gpt-test", inputTokens: 900, outputTokens: 100, nanoAiu: 3_700_000 }]
    const result = await labelComments(store, COPILOT, { labeler: fakeLabeler({ usage }) })
    assert.equal(result.labeled, result.considered)
    assert.equal(result.unlabeled, 0)
    assert.deepEqual(result.models, ["gpt-test"])
    assert.deepEqual(result.usage, {
      requests: 1,
      inputTokens: 900,
      outputTokens: 100,
      nanoAiu: 3_700_000,
    })
    const labels = await labelsBy(store, "agent:copilot")
    assert.equal(labels.length, result.labeled)
    assert.deepEqual(labels[0].actor, { kind: "agent", id: "agent:copilot", model: "gpt-test" })
  })

  it("refuses labels that break the contract and records the rest", async () => {
    const store = await storeWith()
    let turn = 0
    const labeler = fakeLabeler({
      label: () =>
        [
          { signal: "made_up" },
          { theme: { key: "Visible Form_Labels", statement: "  Label\n every field.  " } },
          { theme: { key: "???", statement: "Label every field." } },
          { theme: { key: "visible-form-labels", statement: "" } },
          { comment: "ev_unknown" },
        ][turn++] ?? {},
    })
    const result = await labelComments(store, COPILOT, { labeler })
    assert.deepEqual(
      result.rejected.map((item) => item.reason),
      [
        "Its signal is not one the contract allows.",
        "Its theme key is not kebab-case.",
        "Its statement is empty or too long.",
        "It names a comment that was not asked about or already has a label.",
      ],
    )
    assert.equal(result.labeled, result.considered - 4)
    const normalized = (await labelsBy(store, "agent:copilot")).find(
      (event) => event.payload.theme.statement === "Label every field.",
    )
    assert.equal(normalized.payload.theme.key, "visible-form-labels")
  })

  it("takes at most one label for each comment", async () => {
    const store = await storeWith()
    const labeler = fakeLabeler()
    const original = labeler.label
    labeler.label = async (request) => {
      const answer = await original(request)
      return { ...answer, labels: [...answer.labels, answer.labels[0]] }
    }
    const result = await labelComments(store, COPILOT, { labeler })
    assert.equal(result.rejected.length, 1)
    assert.equal((await labelsBy(store, "agent:copilot")).length, result.labeled)
  })

  it("asks only about comments it has not labeled, with the themes already in use", async () => {
    const store = await createLearningStore({
      provider: createInMemoryProvider(),
      clock: () => Date.parse("2026-10-09T12:00:00Z"),
    })
    const grant = await store.addGrant(designer(), {
      purposes: ["review", "instruction"],
      sources: ["hub_review_comments"],
      basis: "A Hub administrator turned on Learnings.",
    })
    await store.importHubReviewComments(COPILOT, weekOneLog(), { grantIds: [grant.id] })
    const first = fakeLabeler()
    await labelComments(store, COPILOT, { labeler: first })
    const firstAsked = new Set(
      first.requests.flatMap((request) =>
        request.threads.flatMap((thread) =>
          thread.comments.filter((comment) => comment.label).map((comment) => comment.id),
        ),
      ),
    )
    const idle = fakeLabeler()
    assert.equal((await labelComments(store, COPILOT, { labeler: idle })).considered, 0)
    assert.equal(idle.requests.length, 0)

    await store.importHubReviewComments(COPILOT, weekTwoLog(), { grantIds: [grant.id] })
    const second = fakeLabeler()
    const result = await labelComments(store, COPILOT, { labeler: second })
    assert.ok(result.considered > 0)
    const [request] = second.requests
    assert.deepEqual(request.themes, [
      { key: "visible-form-labels", statement: "Show a visible label above every field." },
    ])
    for (const comment of request.threads.flatMap((thread) => thread.comments))
      if (comment.label) assert.equal(firstAsked.has(comment.id), false, comment.id)
  })

  it("reassesses prior labels and supersedes them with the new judgment", async () => {
    const store = await storeWith()
    await labelComments(store, COPILOT, { labeler: fakeLabeler() })
    const previous = await labelsBy(store, "agent:copilot")
    const labeler = fakeLabeler({
      label: () => ({
        theme: { key: "visible-form-labels", statement: "Use visible labels for form fields." },
        signal: "usability",
      }),
    })

    const result = await labelComments(store, COPILOT, { labeler, relabel: true })

    assert.equal(result.considered, previous.length)
    assert.equal(result.labeled, previous.length)
    const latest = (await labelsBy(store, "agent:copilot")).filter((event) =>
      previous.some((item) => item.id === event.supersedes),
    )
    assert.equal(latest.length, previous.length)
    assert.ok(latest.every((event) => event.payload.signal === "usability"))
  })

  it("stops proposing a theme once a reassessment finds nothing to label, until it is labeled again", async () => {
    const store = await storeWith()
    const window = { from: "2026-10-01T00:00:00.000000Z", to: "2026-10-09T12:00:00.000000Z" }
    async function proposedThemes() {
      const run = await store.consolidate(COPILOT, {
        consolidator: createRecurrenceConsolidator(),
        window,
        dryRun: true,
      })
      return run.proposals.map((proposal) => proposal.themeKey)
    }
    await labelComments(store, COPILOT, { labeler: fakeLabeler() })
    assert.deepEqual(await proposedThemes(), ["visible-form-labels"])

    const nothing = fakeLabeler()
    nothing.label = async () => ({ labels: [] })
    await labelComments(store, COPILOT, { labeler: nothing, relabel: true })
    assert.deepEqual(await proposedThemes(), [])

    await labelComments(store, COPILOT, { labeler: fakeLabeler(), relabel: true })
    assert.deepEqual(await proposedThemes(), ["visible-form-labels"])
  })

  it("stops at the limit and says how many comments wait", async () => {
    const store = await storeWith()
    const result = await labelComments(store, COPILOT, { labeler: fakeLabeler(), limit: 2 })
    assert.equal(result.considered, 2)
    assert.equal(result.labeled, 2)
    assert.ok(result.remaining > 0)
    const rest = await labelComments(store, COPILOT, { labeler: fakeLabeler() })
    assert.equal(rest.considered, result.remaining)
  })

  it("stops after the requests it may make, and the comments it did not reach keep waiting", async () => {
    const store = await storeWith({ log: lengthened(weekOneLog()) })
    const usage = [{ model: "test-model", inputTokens: 100, outputTokens: 20, nanoAiu: 5 }]
    const first = fakeLabeler({ usage })
    const result = await labelComments(store, COPILOT, { labeler: first, maxRequests: 1 })
    const asked = first.requests[0].threads.flatMap((thread) =>
      thread.comments.filter((comment) => comment.label),
    )
    assert.deepEqual(
      [first.requests.length, result.usage.requests, result.considered, result.labeled],
      [1, 1, asked.length, asked.length],
    )
    assert.ok(result.remaining > 0)
    const rest = await labelComments(store, COPILOT, { labeler: fakeLabeler() })
    assert.equal(rest.considered, result.remaining)
    await assert.rejects(labelComments(store, COPILOT, { labeler: first, maxRequests: 0 }), {
      code: "invalid_input",
    })
  })

  it("asks only about comments written since a time", async () => {
    const all = await labelComments(await storeWith(), COPILOT, { labeler: fakeLabeler() })
    const store = await storeWith()
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const writtenAt = new Map(events.map((event) => [event.id, event.at]))
    const since = "2026-10-02T00:00:00.000000Z"
    const labeler = fakeLabeler()
    const result = await labelComments(store, COPILOT, { labeler, since })

    const asked = labeler.requests.flatMap((request) =>
      request.threads.flatMap((thread) => thread.comments.filter((comment) => comment.label)),
    )
    assert.ok(asked.length > 0)
    assert.ok(result.considered + result.remaining < all.considered + all.remaining)
    for (const comment of asked) assert.ok(writtenAt.get(comment.id) >= since, comment.id)
    await assert.rejects(labelComments(store, COPILOT, { labeler, since: "yesterday" }), {
      code: "invalid_input",
    })
  })

  it("reconciles a write that commits before reporting failure", async () => {
    const store = await storeWith()
    const usage = [{ model: "test-model", inputTokens: 100, outputTokens: 10, nanoAiu: 25 }]
    const wrapper = {
      queryObservations: (...args) => store.queryObservations(...args),
      async annotate(...args) {
        await store.annotate(...args)
        throw new LearningError("storage_outcome_unknown", "Response lost after commit.")
      },
      recordNoAnnotation: (...args) => store.recordNoAnnotation(...args),
    }
    await assert.rejects(
      labelComments(wrapper, COPILOT, { labeler: fakeLabeler({ usage }) }),
      (error) => {
        assert.equal(error.code, "storage_outcome_unknown")
        assert.equal(error.details.labelingResult.remaining, 0)
        assert.equal(error.details.labelingResult.labeled, error.details.labelingResult.considered)
        assert.equal(
          error.details.labelingResult.events.length,
          error.details.labelingResult.labeled,
        )
        assert.equal(error.details.labelingResult.usage.nanoAiu, 25)
        assert.equal(error.details.labelingResult.progressError, undefined)
        return true
      },
    )
    assert.equal((await labelComments(store, COPILOT, { labeler: fakeLabeler() })).considered, 0)
  })

  it("exposes a reconciliation failure while preserving known usage and the original error", async () => {
    const store = await storeWith()
    let reads = 0
    const usage = [{ model: "test-model", inputTokens: 100, outputTokens: 10, nanoAiu: 25 }]
    const wrapper = {
      async queryObservations(...args) {
        if (++reads > 1) throw new LearningError("storage_corrupt", "Cannot re-read markers.")
        return store.queryObservations(...args)
      },
      annotate: async () => {
        throw new LearningError("unavailable", "Write failed.")
      },
    }
    await assert.rejects(
      labelComments(wrapper, COPILOT, { labeler: fakeLabeler({ usage }) }),
      (error) => {
        assert.equal(error.code, "unavailable")
        assert.equal(error.message, "Write failed.")
        assert.equal(error.details.labelingResult.usage.nanoAiu, 25)
        assert.match(error.details.labelingResult.progressError, /Cannot re-read markers/)
        assert.ok(error.details.labelingResult.remaining > 0)
        return true
      },
    )
  })

  it("keeps later groups unasked after review consent changes during a capped request", async () => {
    const log = weekOneLog()
    for (const call of log.calls)
      for (const root of call.result.threads ?? (call.result.thread ? [call.result.thread] : [])) {
        root.body = "Long design feedback. ".repeat(120)
        for (const reply of root.replies) reply.body = "Long reply feedback. ".repeat(120)
      }
    const store = await storeWith({ log })
    const labeler = fakeLabeler()
    const original = labeler.label
    const [{ grant }] = await store.listGrants(designer())
    labeler.label = async (request) => {
      const answer = await original(request)
      await store.withdrawGrant(designer(), grant.id, { purposes: ["review"] })
      return answer
    }
    await labelComments(store, COPILOT, { labeler, maxRequests: 1 })
    assert.equal(labeler.requests.length, 1)
    const next = fakeLabeler()
    assert.equal(
      (await labelComments(store, COPILOT, { labeler: next, maxRequests: 1 })).considered,
      0,
    )
    assert.equal(next.requests.length, 0)
  })

  it("refuses malformed usage instead of returning negative, fractional, or non-string fields", async () => {
    for (const item of [
      { model: 7, inputTokens: 1 },
      { model: "test", inputTokens: -1 },
      { model: "test", outputTokens: 1.5 },
      { model: "test", nanoAiu: Infinity },
    ]) {
      const store = await storeWith()
      await assert.rejects(
        labelComments(store, COPILOT, { labeler: fakeLabeler({ usage: [item] }) }),
        { code: "invalid_record" },
      )
      assert.equal((await labelsBy(store, COPILOT.principal.id)).length, 0)
    }
  })

  it("asks about each comment once, also when it leaves the comment unlabeled", async () => {
    const store = await storeWith()
    const first = await labelComments(store, COPILOT, { labeler: pickyLabeler() })
    assert.ok(first.labeled > 0 && first.unlabeled > 0)

    const again = pickyLabeler()
    const second = await labelComments(store, COPILOT, { labeler: again })
    assert.deepEqual([second.considered, second.remaining, again.requests.length], [0, 0, 0])
    const other = await labelComments(
      store,
      { ...COPILOT, principal: { kind: "agent", id: "agent:second-opinion" } },
      { labeler: fakeLabeler() },
    )
    assert.equal(other.considered, first.considered, "another labeler still reads every comment")
  })

  it("never asks about a comment deleted before it was imported", async () => {
    const store = await storeWith({ log: weekTwoLog() })
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const deleted = events.find(
      (event) => event.type === "human_comment" && event.payload.commentId === 107,
    )
    assert.equal(deleted.payload.body, null)
    const labeler = fakeLabeler()
    const result = await labelComments(store, COPILOT, { labeler })
    const sent = labeler.requests.flatMap((request) =>
      request.threads.flatMap((thread) => thread.comments.map((comment) => comment.id)),
    )
    assert.ok(result.considered > 0)
    assert.equal(sent.includes(deleted.id), false)
  })

  it("records that a labeler left a live comment unlabeled once for each labeler", async () => {
    const store = await storeWith()
    const { events } = await store.queryObservations(designer(), { purpose: "review" })
    const comment = events.find((event) => event.type === "human_comment")
    const [marked] = await store.recordNoAnnotation(COPILOT, [comment.id])
    assert.deepEqual([marked.type, marked.parentEventId], ["no_annotation", comment.id])
    assert.deepEqual(await store.recordNoAnnotation(COPILOT, [comment.id]), [])
    await assert.rejects(store.recordNoAnnotation(COPILOT, [marked.id]), { code: "not_found" })
  })

  it("labels only as an agent", async () => {
    const store = await storeWith()
    await assert.rejects(labelComments(store, designer(), { labeler: fakeLabeler() }), {
      code: "invalid_input",
    })
  })
})
