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
import { get as getEvaluations } from "./evaluations/get/index.ts"
import { patch as patchEvaluations } from "./evaluations/patch/index.ts"
import { get as getLearningHistory } from "./history/get/index.ts"
import { get as getAppliedLearnings } from "./applied/get/index.ts"
import { get as getScreenshot } from "./screenshots/get/index.ts"
import { post as postRun } from "./runs/post/index.ts"
import { post as postShare } from "./share/post/index.ts"
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
    getHistory: vi.fn().mockResolvedValue({
      decisions: [],
      evidence: [],
      otherEvidenceCount: 0,
      contradictions: [],
      otherContradictionsCount: 0,
    }),
    getAppliedLearnings: vi.fn().mockResolvedValue([]),
    readScreenshot: vi.fn().mockResolvedValue(null),
    isScreenshotGrantActive: vi.fn().mockResolvedValue(true),
    getCopilot: vi.fn().mockResolvedValue({ state: "connected", connectedBy: "mona" }),
    listRuns: vi.fn().mockResolvedValue({ runs: [], usageCredits: "0", active: null }),
    listActivity: vi.fn().mockResolvedValue([]),
    decide: vi.fn().mockResolvedValue({ notice: "Learning accepted." }),
    share: vi.fn().mockResolvedValue({ notice: "Shared across Hub." }),
    getEvaluationSettings: vi.fn().mockResolvedValue({
      monthlyBudgetCredits: "0",
      usedCredits: "0",
      enabled: false,
      screenshots: { allowed: false, changedBy: null, changedAt: null },
    }),
    changeEvaluationSettings: vi.fn().mockResolvedValue({ notice: "Evaluation settings saved." }),
    changeEvaluationBudget: vi.fn().mockResolvedValue({ notice: "Budget saved." }),
    redactComment: vi.fn().mockResolvedValue(undefined),
    serializeReviewCommentDeletion: (operation) => operation(),
    ...overrides,
  }
}

async function withRoute(
  method: "get" | "post" | "patch",
  path: string,
  handler: RequestHandler,
  operation: (baseUrl: string) => Promise<void>,
) {
  const app = express()
  app.use(express.json())
  if (method === "get") app.get(path, handler)
  else if (method === "patch") app.patch(path, handler)
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

  it("lets a repository member read the library and its activity without deciding or seeing usage", async () => {
    const listRuns = vi.fn()
    const day = {
      date: "2026-12-21",
      runState: "succeeded",
      startedAt: "2026-12-21T09:00:00.000Z",
      startedBy: { type: "daily" },
      commentsAnalyzed: 4,
      commentsTagged: 3,
      suggestions: 1,
    }
    const deps = dependencies({
      authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
      getOverview: vi.fn().mockResolvedValue({
        loadError: null,
        identityReviewCount: 0,
        suggestions: [],
        learnings: [],
        rejected: [{ id: "mem_1", state: "rejected", reason: "Too broad." }],
        recall: { text: "", count: 0 },
      }),
      listRuns,
      listActivity: vi.fn().mockResolvedValue([day]),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings",
      getLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings`, {
          headers,
        })
        const body: unknown = await response.json()

        expect(response.status).toBe(200)
        expect(body).toMatchObject({
          accessDenied: false,
          capabilities: { administerHub: false, administerRepository: false },
          permissions: { viewEvidence: true, decide: false, requestRun: false },
          usageCredits: null,
          runAvailable: false,
          runs: [],
          activity: [day],
          rejected: [{ id: "mem_1", reason: "Too broad." }],
        })
        expect(listRuns).not.toHaveBeenCalled()
      },
    )
  })

  it("maps the repository administrator overview for a Hub member", async () => {
    const loadError =
      "Rebuild learning mem_111111111111111111111111. Follow up on export exp_222222222222222222222222 at private/exports/team.json."
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
        loadError,
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
          permissions: { viewEvidence: true, decide: true, requestRun: false, share: false },
          copilot: { state: "connected", connectedBy: "mona" },
          automaticRunsEnabled: true,
          usageCredits: "0.021",
          runAvailable: false,
          loadError,
          identityReviewCount: 1,
          suggestions: [suggestion],
          learnings: [],
          recall: { text: "Approved team learnings", count: 0 },
          runs: [run],
          activity: [],
          today: new Date().toISOString().slice(0, 10),
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

  it("drops administrator data when repository authority is lost while loading", async () => {
    const listRuns = vi.fn().mockResolvedValue({
      runs: [{ id: 17 }],
      usageCredits: "12.5",
      active: null,
    })
    const deps = dependencies({
      authorizeRepositoryAdministration: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
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
        const body: unknown = await response.json()

        expect(response.status).toBe(200)
        expect(body).toMatchObject({
          capabilities: { administerRepository: false },
          permissions: { decide: false, requestRun: false },
          usageCredits: null,
          runAvailable: false,
          runs: [],
        })
        expect(listRuns).toHaveBeenCalledOnce()
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

  it("passes edits and reinstatements to the decision boundary", async () => {
    const decide = vi.fn().mockResolvedValue({ notice: "Learning updated." })
    const deps = dependencies({ decide })

    await withRoute(
      "post",
      "/api/repositories/:repositoryId/learnings/:learningId/decision",
      postDecision(deps),
      async (baseUrl) => {
        const url = `${baseUrl}/api/repositories/${repositoryId}/learnings/mem_1/decision`
        const edit = await fetch(url, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            decision: "edit",
            digest: `sha256:${"a".repeat(64)}`,
            title: "Keep labels visible",
            reason: "Clarify the guidance.",
          }),
        })
        const reinstate = await fetch(url, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            decision: "reinstate",
            digest: `sha256:${"b".repeat(64)}`,
            reason: "The guidance applies again.",
          }),
        })

        expect(edit.status).toBe(200)
        expect(reinstate.status).toBe(200)
        expect(decide).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            decision: {
              decision: "edit",
              digest: `sha256:${"a".repeat(64)}`,
              title: "Keep labels visible",
              reason: "Clarify the guidance.",
            },
          }),
        )
        expect(decide).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            decision: {
              decision: "reinstate",
              digest: `sha256:${"b".repeat(64)}`,
              reason: "The guidance applies again.",
            },
          }),
        )
      },
    )
  })

  it("refuses an edit that changes nothing", async () => {
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
            body: JSON.stringify({
              decision: "edit",
              digest: `sha256:${"a".repeat(64)}`,
              reason: "Clarify the guidance.",
            }),
          },
        )

        expect(response.status).toBe(422)
        expect(decide).not.toHaveBeenCalled()
      },
    )
  })

  it("shows a learning's history to a repository member", async () => {
    const history = {
      decisions: [
        {
          version: 1,
          state: "proposed",
          change: "proposed",
          by: null,
          at: "2026-11-20T10:00:00.000Z",
          reason: null,
        },
      ],
      evidence: [],
      otherEvidenceCount: 0,
      contradictions: [],
      otherContradictionsCount: 0,
    }
    const getHistory = vi.fn().mockResolvedValue(history)
    const deps = dependencies({
      authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
      getHistory,
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/:learningId/history",
      getLearningHistory(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/mem_1/history`,
          { headers },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual(history)
        expect(getHistory).toHaveBeenCalledWith({ repositoryId, learningId: "mem_1" })
      },
    )
  })

  it("lists the learnings reported for a prototype's commit", async () => {
    const prototypeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    const commitSha = "a".repeat(40)
    const applied = [{ id: "mem_1", title: "Label every field", version: 2 }]
    const getApplied = vi.fn().mockResolvedValue(applied)
    const deps = dependencies({ getAppliedLearnings: getApplied })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/applied",
      getAppliedLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/applied?prototype=${prototypeId}&commit=${commitSha}`,
          { headers },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ learnings: applied })
        expect(getApplied).toHaveBeenCalledWith({ repositoryId, prototypeId, commitSha })
      },
    )
  })

  it("serves an agent screenshot only as an image", async () => {
    const sha256 = "b".repeat(64)
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const readScreenshot = vi.fn().mockResolvedValue({ bytes, grantId: "grant-1" })
    const deps = dependencies({ readScreenshot })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/screenshots/:sha256",
      getScreenshot(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/screenshots/${sha256}`,
          { headers },
        )

        expect(response.status).toBe(200)
        expect(response.headers.get("content-type")).toBe("image/png")
        expect(response.headers.get("x-content-type-options")).toBe("nosniff")
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
        expect(readScreenshot).toHaveBeenCalledWith({ repositoryId, sha256 })
      },
    )
  })

  it("refuses an applied-learnings address without a prototype and full commit", async () => {
    const getApplied = vi.fn()
    const deps = dependencies({ getAppliedLearnings: getApplied })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/applied",
      getAppliedLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/applied?prototype=cccccccc-cccc-4ccc-8ccc-cccccccccccc&commit=abc123`,
          { headers },
        )

        expect(response.status).toBe(400)
        expect(getApplied).not.toHaveBeenCalled()
      },
    )
  })

  it("hides applied learnings after repository access is lost while they load", async () => {
    const deps = dependencies({
      findRepository: vi.fn().mockResolvedValueOnce(repository).mockResolvedValueOnce(null),
      getAppliedLearnings: vi
        .fn()
        .mockResolvedValue([{ id: "mem_1", title: "Label every field", version: 2 }]),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/applied",
      getAppliedLearnings(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/applied?prototype=cccccccc-cccc-4ccc-8ccc-cccccccccccc&commit=${"a".repeat(40)}`,
          { headers },
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
          code: "repository_not_found",
          error: "Repository not found.",
        })
      },
    )
  })

  it("treats a malformed screenshot address as not found", async () => {
    const readScreenshot = vi.fn()
    const deps = dependencies({ readScreenshot })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/screenshots/:sha256",
      getScreenshot(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/screenshots/not-a-digest`,
          { headers },
        )

        expect(response.status).toBe(404)
        expect(readScreenshot).not.toHaveBeenCalled()
      },
    )
  })

  it("withholds a screenshot from someone signed out while it loads", async () => {
    const deps = dependencies({
      currentSession: {
        restore: vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(null),
      },
      readScreenshot: vi
        .fn()
        .mockResolvedValue({ bytes: new Uint8Array([0x89]), grantId: "grant-1" }),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/screenshots/:sha256",
      getScreenshot(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/screenshots/${"b".repeat(64)}`,
          { headers },
        )

        expect(response.status).toBe(401)
      },
    )
  })

  it("withholds a screenshot when consent is withdrawn while it loads", async () => {
    const isScreenshotGrantActive = vi.fn().mockResolvedValue(false)
    const deps = dependencies({
      readScreenshot: vi
        .fn()
        .mockResolvedValue({ bytes: new Uint8Array([0x89]), grantId: "grant-1" }),
      isScreenshotGrantActive,
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/screenshots/:sha256",
      getScreenshot(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/screenshots/${"b".repeat(64)}`,
          { headers },
        )

        expect(response.status).toBe(404)
        expect(isScreenshotGrantActive).toHaveBeenCalledWith({ repositoryId, grantId: "grant-1" })
      },
    )
  })

  it("hides whether a learning exists after repository access is lost", async () => {
    const deps = dependencies({
      findRepository: vi.fn().mockResolvedValueOnce(repository).mockResolvedValueOnce(null),
      getHistory: vi
        .fn()
        .mockRejectedValue(
          new LearningCommandError("not_found", "That learning no longer exists."),
        ),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/:learningId/history",
      getLearningHistory(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/mem_1/history`,
          { headers },
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ code: "repository_not_found" })
      },
    )
  })

  it("shares a learning only for someone who administers both Hub and its repository", async () => {
    const share = vi.fn().mockResolvedValue({ notice: "Shared across Hub." })
    const auditRepositoryAdministrationDenial = vi.fn().mockResolvedValue(undefined)
    const administrator = { ...session, role: "ADMINISTRATOR" as const }
    const authorizeRepositoryAdministration = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const deps = dependencies({
      currentSession: {
        restore: vi
          .fn()
          .mockResolvedValueOnce(session)
          .mockResolvedValueOnce(administrator)
          .mockResolvedValue(administrator),
      },
      authorizeRepositoryAdministration,
      auditRepositoryAdministrationDenial,
      share,
    })

    await withRoute(
      "post",
      "/api/repositories/:repositoryId/learnings/:learningId/share",
      postShare(deps),
      async (baseUrl) => {
        function request() {
          return fetch(`${baseUrl}/api/repositories/${repositoryId}/learnings/mem_1/share`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ shared: true }),
          })
        }

        const member = await request()
        expect(member.status).toBe(403)
        const hubAdministratorOnly = await request()
        expect(hubAdministratorOnly.status).toBe(403)
        expect(auditRepositoryAdministrationDenial).toHaveBeenCalledWith({
          actorMembershipId: session.membershipId,
          operation: "learning_share",
          repositoryId,
        })
        expect(share).not.toHaveBeenCalled()

        const both = await request()
        expect(both.status).toBe(200)
        expect(share).toHaveBeenCalledWith({
          repositoryId,
          learningId: "mem_1",
          actorMembershipId: session.membershipId,
          shared: true,
          sessionDigest: hashAuthenticationValue("current-session"),
        })
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
  it("hides evaluation settings from a member who administers neither Hub nor the repository", async () => {
    const deps = dependencies({
      authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
    })

    await withRoute(
      "get",
      "/api/repositories/:repositoryId/learnings/evaluations",
      getEvaluations(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/evaluations`,
          { headers },
        )

        expect(response.status).toBe(403)
      },
    )
  })
  it("refuses and records an evaluation change from a member who is not a repository administrator", async () => {
    const changeEvaluationSettings = vi.fn()
    const auditRepositoryAdministrationDenial = vi.fn().mockResolvedValue(undefined)
    const deps = dependencies({
      authorizeRepositoryAdministration: vi.fn().mockResolvedValue(false),
      auditRepositoryAdministrationDenial,
      changeEvaluationSettings,
    })

    await withRoute(
      "patch",
      "/api/repositories/:repositoryId/learnings/evaluations",
      patchEvaluations(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/evaluations`,
          {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ enabled: true }),
          },
        )

        expect(response.status).toBe(403)
        expect(auditRepositoryAdministrationDenial).toHaveBeenCalledWith({
          actorMembershipId: session.membershipId,
          operation: "learning_evaluation",
          repositoryId,
        })
        expect(changeEvaluationSettings).not.toHaveBeenCalled()
      },
    )
  })
  it("saves a repository administrator's evaluation change under their current session", async () => {
    const changeEvaluationSettings = vi.fn().mockResolvedValue({ notice: "Saved." })
    const deps = dependencies({ changeEvaluationSettings })

    await withRoute(
      "patch",
      "/api/repositories/:repositoryId/learnings/evaluations",
      patchEvaluations(deps),
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/repositories/${repositoryId}/learnings/evaluations`,
          {
            method: "PATCH",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ enabled: true, screenshots: true }),
          },
        )

        expect(response.status).toBe(200)
        expect(changeEvaluationSettings).toHaveBeenCalledWith({
          repositoryId,
          actor: "human:mona",
          actorMembershipId: session.membershipId,
          sessionDigest: hashAuthenticationValue("current-session"),
          enabled: true,
          screenshots: true,
        })
      },
    )
  })
})
