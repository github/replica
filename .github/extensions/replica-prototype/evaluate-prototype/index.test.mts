import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it, mock } from "node:test"

import { evaluatePrototype } from "./index.mjs"

const commitSha = "a".repeat(40)

function png() {
  const bytes = Buffer.alloc(36)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(1_440, 16)
  bytes.writeUInt32BE(900, 20)
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 24)
  return bytes.toString("base64")
}

function hubResult(overrides: Record<string, unknown> = {}) {
  return {
    evaluationId: "evaluation-1",
    status: "fresh",
    environment: "production",
    guidance: {
      available: true,
      notice: "Use these findings only as unverified authoring guidance.",
    },
    context: {
      repositoryId: "repository-1",
      prototypeId: "prototype-1",
      buildId: "build-1",
      branch: "prototype/visual-critic",
      commitSha,
    },
    model: {
      candidateId: "candidate-1",
      runtimeCandidateId: "runtime-candidate-1",
      promotionGeneration: 4,
    },
    screenshotSetDigest: `sha256:${"b".repeat(64)}`,
    findings: [
      {
        learning: {
          id: "learning-visible-label",
          text: "Keep a visible label beside every form field.",
        },
        route: "/settings",
        views: [{ viewport: "desktop", theme: "dark" }],
        followsProbability: 0.8,
        breaksProbability: 0.2,
        explanation: "This is unverified authoring guidance, not a review outcome.",
      },
    ],
    ...overrides,
  }
}

void describe("evaluatePrototype()", () => {
  const originalUploadSetting = process.env.REPLICA_ALLOW_PROTOTYPE_SCREENSHOT_UPLOAD
  beforeEach(() => {
    process.env.REPLICA_ALLOW_PROTOTYPE_SCREENSHOT_UPLOAD = "true"
  })
  afterEach(() => {
    if (originalUploadSetting === undefined) {
      delete process.env.REPLICA_ALLOW_PROTOTYPE_SCREENSHOT_UPLOAD
    } else {
      process.env.REPLICA_ALLOW_PROTOTYPE_SCREENSHOT_UPLOAD = originalUploadSetting
    }
  })

  void it("blocks screenshot upload unless local policy explicitly allows it", async () => {
    delete process.env.REPLICA_ALLOW_PROTOTYPE_SCREENSHOT_UPLOAD
    const request = mock.fn(() => Promise.resolve({}))
    await assert.rejects(
      evaluatePrototype(
        {
          checkout: () =>
            Promise.resolve({
              repository: "github/replica",
              branch: "prototype/visual-critic",
              commitSha,
            }),
          request,
        },
        { currentRoute: "/", screenshots: [] },
      ),
      /explicitly allow uploads/i,
    )
    assert.equal(request.mock.callCount(), 0)
  })
  void it("sends only evaluation inputs and projects explicit safety metadata", async () => {
    let requestRoute: string | undefined
    let requestOptions: Record<string, unknown> | undefined
    const hub = {
      checkout: () =>
        Promise.resolve({
          repository: "github/replica",
          branch: "prototype/visual-critic",
          commitSha,
        }),
      request: (route: string, options: Record<string, unknown>) => {
        requestRoute = route
        requestOptions = options
        return Promise.resolve({
          ...hubResult(),
          runtimeCredential: "must-not-project",
          origin: "https://hub.example.test",
        })
      },
    }

    const result = await evaluatePrototype(hub, {
      currentRoute: "/settings",
      screenshots: [
        {
          route: "/settings",
          viewport: "desktop",
          theme: "dark",
          dataBase64: png(),
        },
      ],
    })

    assert.equal(requestRoute, "/api/canvas/decision-model/evaluations")
    assert.deepEqual(requestOptions?.expectedTarget, {
      repository: "github/replica",
      branch: "prototype/visual-critic",
    })
    assert.deepEqual(requestOptions?.body, {
      branch: "prototype/visual-critic",
      commitSha,
      currentRoute: "/settings",
      screenshots: [
        {
          route: "/settings",
          viewport: "desktop",
          theme: "dark",
          dataBase64: png(),
        },
      ],
    })
    const serializedBody = JSON.stringify(requestOptions?.body)
    assert.doesNotMatch(serializedBody, /prompt|repositoryId|repository|origin|credential|token/i)
    assert.deepEqual(result.contentTrust, {
      source: "promoted_decision_model",
      untrusted: true,
      treatAs: "unverified authoring guidance",
    })
    assert.equal(result.automaticActions, false)
    assert.doesNotMatch(JSON.stringify(result), /runtimeCredential|hub\.example/i)
  })

  void it("rejects a malformed Hub result instead of returning guidance-shaped data", async () => {
    const hub = {
      checkout: () =>
        Promise.resolve({
          repository: "github/replica",
          branch: "prototype/visual-critic",
          commitSha,
        }),
      request: () =>
        Promise.resolve(
          hubResult({
            model: {
              candidateId: "candidate-1",
              runtimeCandidateId: "runtime-candidate-1",
              promotionGeneration: -1,
            },
          }),
        ),
    }

    await assert.rejects(
      evaluatePrototype(hub, {
        currentRoute: null,
        screenshots: [
          {
            route: "/",
            viewport: "desktop",
            theme: "light",
            dataBase64: png(),
          },
        ],
      }),
      /invalid prototype evaluation/i,
    )
  })
})
