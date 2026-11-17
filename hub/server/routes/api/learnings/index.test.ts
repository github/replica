import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import type { RequestHandler } from "express"
import { describe, expect, it, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { post as postDecision } from "./decision/post/index.ts"
import { get as getLearnings } from "./get/index.ts"
import { post as postRun } from "./runs/post/index.ts"
import type { LearningsRouteDependencies } from "./types.ts"

const repositoryId = "11111111-2222-4333-8444-555555555555"
const repository = {
  id: repositoryId,
  nameWithOwner: "team/design",
  defaultBranch: "main",
}
const session = {
  membershipId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  provider: "github",
  login: "mona",
  name: "Mona",
  role: "ADMINISTRATOR" as const,
}

function dependencies(
  overrides: Partial<LearningsRouteDependencies> = {},
): LearningsRouteDependencies {
  return {
    applicationOrigin: "http://127.0.0.1:5173",
    currentSession: { restore: vi.fn().mockResolvedValue(session) },
    findRepository: vi.fn().mockResolvedValue(repository),
    getOverview: vi.fn().mockResolvedValue({
      loadError: null,
      identityReviewCount: 1,
      suggestions: [],
      learnings: [],
      recall: { text: "", count: 0 },
    }),
    getCopilot: vi.fn().mockResolvedValue({ state: "connected", connectedBy: "mona" }),
    listRuns: vi.fn().mockResolvedValue({ runs: [], usageCredits: "0", active: false }),
    decide: vi.fn().mockResolvedValue({ notice: "Learning accepted." }),
    redactComment: vi.fn().mockResolvedValue(undefined),
    serializeReviewCommentDeletion: (operation) => operation(),
    ...overrides,
  }
}

async function withRoute(
  method: "get" | "post",
  path: string,
  handler: RequestHandler,
  operation: (baseUrl: string) => Promise<void>,
) {
  const app = express()
  app.use(express.json())
  if (method === "get") app.get(path, handler)
  else app.post(path, handler)
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

const headers = { cookie: "hub_session=current-session" }

describe("learning routes", () => {
  it("returns no learning data or permissions to a signed-in non-administrator", async () => {
    const member = { ...session, role: "MEMBER" as const }
    const findRepository = vi.fn().mockResolvedValue(repository)
    const getOverview = vi.fn()
    const getCopilot = vi.fn()
    const listRuns = vi.fn()
    const deps = dependencies({
      currentSession: { restore: vi.fn().mockResolvedValue(member) },
      findRepository,
      getOverview,
      getCopilot,
      listRuns,
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings",
      getLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings`, {
          headers,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          accessDenied: true,
          repository,
          canAdministerHub: false,
        })
        expect(getOverview).not.toHaveBeenCalled()
        expect(getCopilot).not.toHaveBeenCalled()
        expect(listRuns).not.toHaveBeenCalled()
      },
    )
  })

  it("maps the administrator overview, exact evidence, and run history", async () => {
    const evidence = {
      eventId: "review-comment-17",
      commentId: 17,
      body: "The form needs a visible label.",
      authorLogin: "reviewer",
      authorAvatarUrl: "https://avatars.example/reviewer",
      prototypeId: "22222222-3333-4444-8555-666666666666",
      prototypeName: "Signup",
      createdAt: "2026-10-02T14:00:00Z",
    }
    const suggestion = {
      id: "mem_7eb35ba21bbe6c45a9a296b4",
      content: "Show a visible label above every form field.",
      reviewDigest: `sha256:${"a".repeat(64)}`,
      support: { reviewers: 1, prototypes: 1 },
      replaces: [],
      evidence: [evidence],
      otherEvidenceCount: 2,
      contradictions: [],
      otherContradictionsCount: 0,
    }
    const run = {
      id: 8,
      startedAt: "2026-10-03T14:00:00Z",
      startedBy: { type: "user" as const, login: "mona" },
      state: "succeeded" as const,
      result: {
        type: "succeeded" as const,
        commentsConsidered: 4,
        commentsLabeled: 2,
        commentsRemaining: 0,
        suggestions: 1,
        suggestionsRemaining: 0,
      },
      usage: { credits: "0.021", requests: 1 },
    }
    const deps = dependencies({
      getOverview: vi.fn().mockResolvedValue({
        loadError: null,
        identityReviewCount: 1,
        suggestions: [suggestion],
        learnings: [],
        recall: { text: "Approved team learnings", count: 0 },
      }),
      listRuns: vi.fn().mockResolvedValue({
        runs: [run],
        usageCredits: "0.021",
        active: false,
      }),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings",
      getLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings`, {
          headers,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
          accessDenied: false,
          repository,
          canAdministerHub: true,
          permissions: { decide: true, requestRun: false },
          copilot: { state: "connected", connectedBy: "mona" },
          usageCredits: "0.021",
          runAvailable: false,
          loadError: null,
          identityReviewCount: 1,
          suggestions: [suggestion],
          learnings: [],
          recall: { text: "Approved team learnings", count: 0 },
          runs: [run],
        })
      },
    )
  })

  it("does not enqueue a run while a complete review snapshot provider is unavailable", async () => {
    const requestRun = vi.fn()
    const deps = dependencies({ requestRun: undefined })

    await withRoute(
      "post",
      "/api/repositories/:repositoryId/learnings/runs",
      postRun(deps),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings/runs`, {
          method: "POST",
          headers,
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
          code: "review_snapshot_unavailable",
          error:
            "Learnings cannot run until Hub can capture a complete repository review snapshot.",
        })
        expect(requestRun).not.toHaveBeenCalled()
      },
    )
  })

  it("requests a run with the live administrator identity", async () => {
    const requestRun = vi.fn().mockResolvedValue({ notice: "Learning run requested." })
    const deps = dependencies({ requestRun })

    await withRoute(
      "post",
      "/api/repositories/:repositoryId/learnings/runs",
      postRun(deps),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings/runs`, {
          method: "POST",
          headers,
        })

        expect(response.status).toBe(202)
        expect(await response.json()).toEqual({ notice: "Learning run requested." })
        expect(requestRun).toHaveBeenCalledWith({
          actorMembershipId: session.membershipId,
          repositoryId,
          requestedById: session.userId,
        })
      },
    )
  })

  it("rejects an invalid decision before calling the package-store boundary", async () => {
    const decide = vi.fn()
    const deps = dependencies({ decide })

    await withRoute(
      "post",
      "/api/repositories/:repositoryId/learnings/:learningId/decision",
      postDecision(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/mem_1/decision`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ decision: "accept" }),
          },
        )

        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({
          code: "invalid_learning_decision",
          error: "Review the learning decision and try again.",
        })
        expect(decide).not.toHaveBeenCalled()
      },
    )
  })

  it("surfaces a stale digest as a conflict", async () => {
    const decide = vi
      .fn()
      .mockRejectedValue(new LearningCommandError("stale_digest", "The reviewed digest is stale."))
    const deps = dependencies({ decide })

    await withRoute(
      "post",
      "/api/repositories/:repositoryId/learnings/:learningId/decision",
      postDecision(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/mem_1/decision`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({
              decision: "reject",
              digest: `sha256:${"b".repeat(64)}`,
              reason: "Not durable guidance.",
            }),
          },
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
          code: "stale_digest",
          error: "The reviewed digest is stale.",
        })
      },
    )
  })

  it.each([
    [
      "accept",
      {
        decision: "accept",
        digest: `sha256:${"a".repeat(64)}`,
      },
      "Learning accepted.",
    ],
    [
      "edit",
      {
        decision: "accept",
        digest: `sha256:${"a".repeat(64)}`,
        content: "Use visible labels.",
      },
      "Learning accepted.",
    ],
    [
      "reject",
      {
        decision: "reject",
        digest: `sha256:${"a".repeat(64)}`,
        reason: "The evidence does not generalize.",
      },
      "Suggestion rejected.",
    ],
    ["retire", { decision: "retire", reason: "The guidance is obsolete." }, "Learning retired."],
  ] as const)(
    "passes the %s command arguments and returns its notice",
    async (_name, input, notice) => {
      const decide = vi.fn().mockResolvedValue({ notice })
      const deps = dependencies({ decide })

      await withRoute(
        "post",
        "/api/repositories/:repositoryId/learnings/:learningId/decision",
        postDecision(deps),
        async (baseUrl) => {
          const response = await fetch(
            `${baseUrl}/api/repositories/mem-repo/learnings/mem_1/decision`.replace(
              "mem-repo",
              repositoryId,
            ),
            {
              method: "POST",
              headers: { ...headers, "content-type": "application/json" },
              body: JSON.stringify(input),
            },
          )

          expect(response.status).toBe(200)
          expect(await response.json()).toEqual({ notice })
          expect(decide).toHaveBeenCalledWith({
            repositoryId,
            learningId: "mem_1",
            actor: "human:mona",
            actorMembershipId: session.membershipId,
            decision: input,
          })
        },
      )
    },
  )
})
