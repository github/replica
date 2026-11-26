import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createCopilotEvaluator, scoreUsedLearning } from "../src/evaluation.mjs"
import { connectCopilot } from "../src/labelers/copilot.mjs"

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

describe("scoreUsedLearning()", () => {
  it("shows the evaluator the screenshots and diff, and keeps the score with its inputs", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const recorded = []
    const store = {
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

  it("keeps no score when the evaluator gives a low score without naming the issue", async () => {
    const store = {
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
})
