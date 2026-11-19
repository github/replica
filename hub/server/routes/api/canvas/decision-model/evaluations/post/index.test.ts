import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi } from "vitest"

import type { AgentVisualCriticRouteDependencies } from "../../types"
import { post } from "."

const authority = {
  sessionKey: "authorized-session",
  repositoryId: "11111111-1111-4111-8111-111111111111",
  prototypeId: "22222222-2222-4222-8222-222222222222",
  buildId: "33333333-3333-4333-8333-333333333333",
  branch: "prototype/visual-critic",
  commitSha: "a".repeat(40),
}
const evaluationResult = {
  evaluationId: "evaluation-1",
  status: "fresh" as const,
  environment: "production" as const,
  guidance: { available: true, notice: "Unverified authoring guidance." },
  context: {
    repositoryId: authority.repositoryId,
    prototypeId: authority.prototypeId,
    buildId: authority.buildId,
    branch: authority.branch,
    commitSha: authority.commitSha,
  },
  model: {
    candidateId: "candidate-1",
    runtimeCandidateId: "runtime-candidate-1",
    promotionGeneration: 3,
  },
  screenshotSetDigest: `sha256:${"b".repeat(64)}`,
  findings: [],
}

function png() {
  const bytes = Buffer.alloc(36)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(1_440, 16)
  bytes.writeUInt32BE(900, 20)
  Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).copy(bytes, 24)
  return bytes.toString("base64")
}

function dependencies(
  overrides: Partial<AgentVisualCriticRouteDependencies> = {},
): AgentVisualCriticRouteDependencies {
  return {
    authorize: vi.fn().mockResolvedValue(authority),
    evaluate: vi.fn().mockResolvedValue(evaluationResult),
    ...overrides,
  }
}

async function withRoute(
  deps: AgentVisualCriticRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const app = express()
  app.use(express.json())
  app.post("/api/canvas/decision-model/evaluations", post(deps))
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

const requestBody = {
  sessionId: "canvas-session-1",
  branch: authority.branch,
  commitSha: authority.commitSha,
  currentRoute: "/settings",
  screenshots: [
    {
      route: "/settings",
      viewport: "desktop",
      theme: "dark",
      dataBase64: png(),
    },
  ],
}

describe("POST canvas decision-model evaluation", () => {
  it("rejects requests without bearer authorization", async () => {
    const authorize = vi.fn().mockResolvedValue(authority)
    const evaluate = vi.fn()
    const deps = dependencies({ authorize, evaluate })

    await withRoute(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/canvas/decision-model/evaluations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
      })

      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({
        code: "canvas_authorization_required",
      })
      expect(authorize).not.toHaveBeenCalled()
      expect(evaluate).not.toHaveBeenCalled()
    })
  })

  it("forwards only Hub-authorized repository, prototype, and Build context", async () => {
    const authorize = vi.fn().mockResolvedValue(authority)
    const evaluate = vi.fn().mockResolvedValue(evaluationResult)
    const deps = dependencies({ authorize, evaluate })

    await withRoute(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/canvas/decision-model/evaluations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${"token-".padEnd(24, "x")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get("x-replica-canvas-version")).toBe("1")
      expect(authorize).toHaveBeenCalledWith({
        token: "token-xxxxxxxxxxxxxxxxxx",
        sessionId: requestBody.sessionId,
        branch: authority.branch,
        commitSha: authority.commitSha,
      })
      expect(evaluate).toHaveBeenCalledWith({
        authority,
        currentRoute: "/settings",
        screenshots: requestBody.screenshots,
      })
    })
  })

  it("rejects repository identifiers supplied by the request body", async () => {
    const authorize = vi.fn().mockResolvedValue(authority)
    const evaluate = vi.fn()
    const deps = dependencies({ authorize, evaluate })

    await withRoute(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/canvas/decision-model/evaluations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${"token-".padEnd(24, "x")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestBody, repositoryId: "attacker-selected" }),
      })

      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({
        code: "invalid_decision_model_request",
      })
      expect(authorize).not.toHaveBeenCalled()
      expect(evaluate).not.toHaveBeenCalled()
    })
  })
})
