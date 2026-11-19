import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import type { RequestHandler } from "express"
import { describe, expect, it, vi } from "vitest"

import { hashAuthenticationValue } from "../../../domains/authentication/hash-authentication-value"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { LearningsError } from "./errors.ts"
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
  role: "MEMBER" as const,
}

function dependencies(
  overrides: Partial<LearningsRouteDependencies> = {},
): LearningsRouteDependencies {
  return {
    applicationOrigin: "http://127.0.0.1:5173",
    automaticRunsEnabled: false,
    currentSession: { restore: vi.fn().mockResolvedValue(session) },
    findRepository: vi.fn().mockResolvedValue(repository),
    authorizeRepositoryAdministration: vi.fn().mockResolvedValue(true),
    auditRepositoryAdministrationDenial: vi.fn().mockResolvedValue(undefined),
    getOverview: vi.fn().mockResolvedValue({
      loadError: null,
      identityReviewCount: 1,
      suggestions: [],
      learnings: [],
      recall: { text: "", count: 0 },
    }),
    getCopilot: vi.fn().mockResolvedValue({ state: "connected", connectedBy: "mona" }),
    listRuns: vi.fn().mockResolvedValue({ runs: [], usageCredits: "0", active: null }),
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
  it("returns retryable feedback when repository authority cannot be read", async () => {
    const deps = dependencies({
      authorizeRepositoryAdministration: vi
        .fn()
        .mockRejectedValue(
          new LearningsError(
            503,
            "repository_authority_unavailable",
            "Repository access is temporarily unavailable. Try again.",
          ),
        ),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings",
      getLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings`, {
          headers,
        })

        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({
          code: "repository_authority_unavailable",
          error: "Repository access is temporarily unavailable. Try again.",
        })
      },
    )
  })

  it("returns no learning data or permissions to a Hub administrator without repository authority", async () => {
    const administrator = { ...session, role: "ADMINISTRATOR" as const }
    const findRepository = vi.fn().mockResolvedValue(repository)
    const getOverview = vi.fn()
    const getCopilot = vi.fn()
    const listRuns = vi.fn()
    const auditRepositoryAdministrationDenial = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies({
      currentSession: { restore: vi.fn().mockResolvedValue(administrator) },
      findRepository,
      authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
      auditRepositoryAdministrationDenial,
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
          capabilities: {
            administerHub: true,
            administerRepository: false,
          },
        })
        expect(getOverview).not.toHaveBeenCalled()
        expect(getCopilot).not.toHaveBeenCalled()
        expect(listRuns).not.toHaveBeenCalled()
        expect(auditRepositoryAdministrationDenial).toHaveBeenCalledWith({
          actorMembershipId: administrator.membershipId,
          operation: "learning_overview",
          repositoryId,
        })
      },
    )
  })

  it("maps the repository administrator overview for a Hub member", async () => {
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
      automaticRunsEnabled: true,
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
        active: null,
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
          capabilities: {
            administerHub: false,
            administerRepository: true,
          },
          permissions: { viewEvidence: true, decide: true, requestRun: false },
          copilot: { state: "connected", connectedBy: "mona" },
          automaticRunsEnabled: true,
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

  it.each([
    {
      label: "a queued automatic run",
      active: { scheduled: true, state: "QUEUED" as const },
      expected: true,
    },
    {
      label: "a running automatic run",
      active: { scheduled: true, state: "RUNNING" as const },
      expected: false,
    },
    {
      label: "queued user-requested work",
      active: { scheduled: false, state: "QUEUED" as const },
      expected: false,
    },
  ])("reports explicit runs as $expected with $label", async ({ active, expected }) => {
    const deps = dependencies({
      requestRun: vi.fn(),
      listRuns: vi.fn().mockResolvedValue({ runs: [], usageCredits: "0", active }),
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
        expect(await response.json()).toMatchObject({ runAvailable: expected })
      },
    )
  })

  it("does not expose loaded learning data after repository authority is lost", async () => {
    const getOverview = vi.fn().mockResolvedValue({
      loadError: null,
      identityReviewCount: 0,
      suggestions: [{ id: "private-suggestion" }],
      learnings: [],
      recall: { text: "private recall", count: 1 },
    })
    const getCopilot = vi.fn().mockResolvedValue({ state: "connected", connectedBy: "mona" })
    const listRuns = vi.fn().mockResolvedValue({
      runs: [{ id: 17 }],
      usageCredits: "12.5",
      active: false,
    })
    const deps = dependencies({
      authorizeRepositoryAdministration: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
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
        const body = await response.text()

        expect(response.status).toBe(200)
        expect(JSON.parse(body)).toEqual({
          accessDenied: true,
          repository,
          capabilities: {
            administerHub: false,
            administerRepository: false,
          },
        })
        expect(getOverview).toHaveBeenCalledOnce()
        expect(getCopilot).toHaveBeenCalledOnce()
        expect(listRuns).toHaveBeenCalledOnce()
        expect(body).not.toContain("private-suggestion")
        expect(body).not.toContain("private recall")
        expect(body).not.toContain("12.5")
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
          sessionDigest: hashAuthenticationValue("current-session"),
        })
      },
    )
  })

  it.each([
    {
      name: "run",
      path: `/api/repositories/${repositoryId}/learnings/runs`,
      body: undefined,
      mutation: "requestRun" as const,
      operation: "learning_run" as const,
    },
    {
      name: "decision",
      path: `/api/repositories/${repositoryId}/learnings/mem_1/decision`,
      body: {
        decision: "reject",
        digest: `sha256:${"a".repeat(64)}`,
        reason: "This private reason must not be audited.",
      },
      mutation: "decide" as const,
      operation: "learning_decision" as const,
    },
  ])(
    "returns a typed denial and does not reach the $name mutation boundary",
    async ({ path, body, mutation, operation }) => {
      const administrator = { ...session, role: "ADMINISTRATOR" as const }
      const requestRun = vi.fn()
      const decide = vi.fn()
      const auditRepositoryAdministrationDenial = vi.fn().mockResolvedValue(undefined)
      const deps = dependencies({
        currentSession: { restore: vi.fn().mockResolvedValue(administrator) },
        authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
        auditRepositoryAdministrationDenial,
        requestRun,
        decide,
      })
      const handler = mutation === "requestRun" ? postRun(deps) : postDecision(deps)

      await withRoute(
        "post",
        path.replace(repositoryId, ":repositoryId").replace("mem_1", ":learningId"),
        handler,
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: body ? { ...headers, "content-type": "application/json" } : headers,
            body: body ? JSON.stringify(body) : undefined,
          })

          expect(response.status).toBe(403)
          expect(await response.json()).toEqual({
            code: "repository_administrator_required",
            error: "Repository administrator access is required.",
          })
          expect(requestRun).not.toHaveBeenCalled()
          expect(decide).not.toHaveBeenCalled()
          expect(auditRepositoryAdministrationDenial).toHaveBeenCalledWith({
            actorMembershipId: administrator.membershipId,
            operation,
            repositoryId,
          })
        },
      )
    },
  )

  it.each([
    {
      name: "run",
      path: `/api/repositories/${repositoryId}/learnings/runs`,
      body: undefined,
      mutation: "requestRun" as const,
    },
    {
      name: "decision",
      path: `/api/repositories/${repositoryId}/learnings/mem_1/decision`,
      body: { decision: "retire", reason: "Obsolete." },
      mutation: "decide" as const,
    },
  ])(
    "fails the $name closed when repository authority is lost on recheck",
    async ({ path, body, mutation }) => {
      const requestRun = vi.fn()
      const decide = vi.fn()
      const authorizeRepositoryAdministration = vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
      const deps = dependencies({ authorizeRepositoryAdministration, requestRun, decide })
      const handler = mutation === "requestRun" ? postRun(deps) : postDecision(deps)

      await withRoute(
        "post",
        path.replace(repositoryId, ":repositoryId").replace("mem_1", ":learningId"),
        handler,
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: body ? { ...headers, "content-type": "application/json" } : headers,
            body: body ? JSON.stringify(body) : undefined,
          })

          expect(response.status).toBe(403)
          expect(await response.json()).toMatchObject({
            code: "repository_administrator_required",
          })
          expect(authorizeRepositoryAdministration).toHaveBeenCalledTimes(2)
          expect(requestRun).not.toHaveBeenCalled()
          expect(decide).not.toHaveBeenCalled()
        },
      )
    },
  )

  it("does not reach a decision mutation after the Hub session is revoked", async () => {
    const decide = vi.fn()
    const deps = dependencies({
      currentSession: {
        restore: vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(null),
      },
      decide,
    })

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
            body: JSON.stringify({ decision: "retire", reason: "Obsolete." }),
          },
        )

        expect(response.status).toBe(403)
        expect(await response.json()).toMatchObject({
          code: "repository_administrator_required",
        })
        expect(decide).not.toHaveBeenCalled()
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
            sessionDigest: hashAuthenticationValue("current-session"),
          })
        },
      )
    },
  )
})
