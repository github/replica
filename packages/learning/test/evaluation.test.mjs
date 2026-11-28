import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createCopilotEvaluator, scoreUsedLearning } from "../src/evaluation.mjs"
import { createCopilotDrafter } from "../src/updates.mjs"
import { connectCopilot } from "../src/labelers/copilot.mjs"
import { LearningError } from "../src/errors.mjs"

const ANSWER = { efficiency: 4, followed: "followed", reasoning: "The label stayed visible." }

/** A Copilot SDK whose sessions answer from a script and record what they were asked. */
function fakeSdk({ fusionTier, chosenModel = "gpt-test", refuse = () => false }) {
  const sessions = []
  class CopilotClient {
    async start() {}
    async stop() {}
    async getAuthStatus() {
      return { isAuthenticated: true }
    }
    async listModels() {
      return [{ id: "gpt-test", supportedReasoningEfforts: ["low", "medium", "high", "xhigh"] }]
    }
    async createSession(options) {
      if (refuse(options)) throw new Error("Session refused.")
      const handlers = []
      const session = {
        options,
        sent: [],
        model: null,
        on(handler) {
          handlers.push(handler)
          return () => {}
        },
        async setFusionTier(tier) {
          return { status: "pending", pendingFusionTier: tier }
        },
        async setModel(model, settings) {
          session.model = { model, ...settings }
        },
        rpc: { model: { getCurrent: async () => ({ modelId: "auto", fusionTier }) } },
        async sendAndWait(message) {
          session.sent.push(message)
          for (const handler of handlers) {
            handler({ type: "session.auto_mode_resolved", data: { chosenModel } })
            handler({ type: "assistant.usage", data: { model: chosenModel, inputTokens: 1 } })
          }
          return ANSWER
        },
        async disconnect() {},
      }
      sessions.push(session)
      return session
    }
  }
  return { sdk: { CopilotClient }, sessions }
}

describe("connectCopilot().askBest()", () => {
  it("answers with Copilot Fusion at its max tier when the turn confirms it", async () => {
    const { sdk, sessions } = fakeSdk({ fusionTier: "max" })
    const connection = await connectCopilot({ sdk })
    const answer = await connection.askBest({ system: "Judge.", prompt: "Score this." })
    await connection.close()

    assert.deepEqual(answer.route, { kind: "fusion", fusionTier: "max" })
    assert.deepEqual(answer.result, ANSWER)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].options.enableExperimentalMode, true)
  })

  it("falls back to Auto's chosen model at its highest reasoning effort", async () => {
    const { sdk, sessions } = fakeSdk({ fusionTier: undefined })
    const connection = await connectCopilot({ sdk })
    const answer = await connection.askBest({ system: "Judge.", prompt: "Score this." })
    await connection.close()

    assert.deepEqual(answer.route, { kind: "auto", model: "gpt-test", reasoningEffort: "xhigh" })
    assert.deepEqual(sessions[1].model, { model: "gpt-test", reasoningEffort: "xhigh" })
    assert.equal(sessions[1].sent.at(-1).prompt, "Score this.")
    assert.equal(answer.usage.length, 3)
  })

  it("falls back to Auto when Copilot refuses to open a Fusion session", async () => {
    const { sdk } = fakeSdk({ refuse: (options) => options.enableExperimentalMode === true })
    const connection = await connectCopilot({ sdk })
    const answer = await connection.askBest({ system: "Judge.", prompt: "Score this." })
    await connection.close()

    assert.deepEqual(answer.route, { kind: "auto", model: "gpt-test", reasoningEffort: "xhigh" })
  })

  it("still reports the Fusion turn's cost when Auto cannot open a session", async () => {
    const { sdk } = fakeSdk({
      fusionTier: undefined,
      refuse: (options) => options.enableExperimentalMode !== true,
    })
    const connection = await connectCopilot({ sdk })

    await assert.rejects(
      connection.askBest({ system: "Judge.", prompt: "Score this." }),
      (error) => error.details.usage.length === 1,
    )
    await connection.close()
  })
})

describe("connectCopilot()", () => {
  it("uses the SDK's own runtime inside a Copilot CLI session", async () => {
    let options
    class CopilotClient {
      constructor(given) {
        options = given
      }
      async start() {}
      async stop() {}
      async getAuthStatus() {
        return { isAuthenticated: true }
      }
    }
    const previous = process.env.COPILOT_CLI_PATH
    process.env.COPILOT_CLI_PATH = "/usr/local/bin/copilot"
    try {
      const connection = await connectCopilot({ sdk: { CopilotClient } })
      await connection.close()
    } finally {
      if (previous === undefined) delete process.env.COPILOT_CLI_PATH
      else process.env.COPILOT_CLI_PATH = previous
    }

    assert.equal(options.env.COPILOT_CLI_PATH, undefined)
  })
})

/** Every key of every object in a schema, nested ones too, that required leaves out. */
function optionalKeys(schema) {
  if (!schema || typeof schema !== "object") return []
  const own = schema.properties
    ? Object.keys(schema.properties).filter((key) => !schema.required?.includes(key))
    : []
  return [...own, ...Object.values(schema).flatMap(optionalKeys)]
}

describe("Copilot answer formats", () => {
  it("require every key, as Copilot's structured output demands", async () => {
    const schemas = []
    async function connect() {
      return {
        askBest: async ({ schema }) => schemas.push(schema.toJSONSchema()),
        close: async () => {},
      }
    }

    await createCopilotEvaluator({ connect }).evaluate({ prompt: "Score this." })
    await createCopilotDrafter({ connect }).draft({ prompt: "Draft this." })

    assert.equal(schemas.length, 2)
    for (const schema of schemas) assert.deepEqual(optionalKeys(schema), [])
  })
})

describe("scoreUsedLearning()", () => {
  it("shows the evaluator the screenshots and diff, and keeps the score with its inputs", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const recorded = []
    const store = {
      async scoreFor() {
        return null
      },
      async evaluationInputs() {
        return {
          learning: { version: 2, title: "Visible labels", text: "Keep labels visible." },
          report: { commitSha: "a".repeat(40), reportedAt: "2026-10-09T12:00:00.000000Z" },
          screenshots: [
            { sha256: "sha256:kept", role: "after", route: "/", bytes: png },
            { sha256: "sha256:hosted", role: "before", route: "/", bytes: null },
            { sha256: "sha256:gone", role: "before", route: "/", bytes: null },
          ],
        }
      },
      async recordScore(context, request) {
        recorded.push(request)
        return { stored: true, score: { ...request, id: "score_1" } }
      },
    }
    const asked = []
    const evaluator = {
      async evaluate(request) {
        asked.push(request)
        return { result: ANSWER, route: { kind: "fusion", fusionTier: "max" }, usage: [] }
      },
    }

    const result = await scoreUsedLearning(
      store,
      {},
      {
        evaluator,
        usedLearningId: "used_12345678",
        operationId: "33333333-3333-4333-8333-333333333333",
        diff: "+ <label>Email</label>",
        readScreenshot: async (sha256) => (sha256 === "sha256:hosted" ? png : null),
      },
    )

    assert.equal(asked[0].attachments.length, 2)
    assert.equal(asked[0].attachments[0].data, png.toString("base64"))
    assert.match(asked[0].prompt, /<label>Email<\/label>/)
    assert.deepEqual(recorded[0].inputs, ["screenshots", "build_diff"])
    assert.equal(result.score.efficiency, 4)
  })

  it("tells the evaluator a reviewer confirmed the work and keeps that as an input", async () => {
    const recorded = []
    const store = {
      async scoreFor() {
        return null
      },
      async evaluationInputs() {
        return { learning: {}, report: {}, screenshots: [] }
      },
      async recordScore(context, request) {
        recorded.push(request)
        return { stored: true, score: { ...request, id: "score_2" } }
      },
    }
    const asked = []
    const evaluator = {
      async evaluate(request) {
        asked.push(request)
        return { result: ANSWER, route: { kind: "fusion", fusionTier: "max" }, usage: [] }
      },
    }

    await scoreUsedLearning(
      store,
      {},
      {
        evaluator,
        usedLearningId: "used_12345678",
        operationId: "44444444-4444-4444-8444-444444444444",
        reviewerVerifiedAt: "2026-10-10T12:00:00.000000Z",
      },
    )

    assert.match(
      asked[0].prompt,
      /"reviewerVerification":\{"verifiedAt":"2026-10-10T12:00:00.000000Z"\}/,
    )
    assert.deepEqual(recorded[0].inputs, ["reviewer_verification"])
  })

  it("keeps no score when the evaluator gives a low score without naming the issue", async () => {
    const store = {
      async scoreFor() {
        return null
      },
      async evaluationInputs() {
        return { learning: {}, report: {}, screenshots: [] }
      },
      async recordScore() {
        assert.fail("A score without its issue must not be kept.")
      },
    }
    const evaluator = createCopilotEvaluator({
      connect: async () => ({
        askBest: async () => ({
          result: { efficiency: 1, followed: "not_followed", reasoning: "Ignored." },
          route: { kind: "fusion", fusionTier: "max" },
          usage: [{ model: "m", inputTokens: 1, outputTokens: 1, nanoAiu: 5 }],
        }),
      }),
    })

    await assert.rejects(
      scoreUsedLearning(
        store,
        {},
        {
          evaluator,
          usedLearningId: "used_12345678",
          operationId: "33333333-3333-4333-8333-333333333333",
        },
      ),
      (error) => error.code === "unavailable" && error.details.usage[0].nanoAiu === 5,
    )
  })

  it("returns a retried attempt's score without asking Copilot again", async () => {
    const kept = { id: "score_1", efficiency: 3, route: { kind: "fusion", fusionTier: "max" } }
    const store = {
      async scoreFor() {
        return kept
      },
    }
    const evaluator = {
      async evaluate() {
        assert.fail("A scored attempt must not be paid for twice.")
      },
    }

    const result = await scoreUsedLearning(
      store,
      {},
      {
        evaluator,
        usedLearningId: "used_12345678",
        operationId: "33333333-3333-4333-8333-333333333333",
      },
    )

    assert.deepEqual([result.score, result.stored, result.usage], [kept, false, []])
  })

  it("reports what Copilot cost when the score cannot be saved", async () => {
    const store = {
      async scoreFor() {
        return null
      },
      async evaluationInputs() {
        return { learning: {}, report: {}, screenshots: [] }
      },
      async recordScore() {
        throw new LearningError("not_found", "The learning was deleted.")
      },
    }
    const evaluator = {
      async evaluate() {
        return {
          result: ANSWER,
          route: { kind: "fusion", fusionTier: "max" },
          usage: [{ model: "m", inputTokens: 1, outputTokens: 1, nanoAiu: 7 }],
        }
      },
    }

    await assert.rejects(
      scoreUsedLearning(
        store,
        {},
        {
          evaluator,
          usedLearningId: "used_12345678",
          operationId: "33333333-3333-4333-8333-333333333333",
        },
      ),
      (error) => error.code === "not_found" && error.details.usage[0].nanoAiu === 7,
    )
  })
})
