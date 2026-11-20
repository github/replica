import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import SettingsLearningsRoute, {
  clientAction as saveLearnings,
  clientLoader as loadLearnings,
  meta,
} from "./settings-learnings"
import { renderHubFlow } from "./fixtures/render-hub-flow"

const digest = `sha256:${"a".repeat(64)}`

function LearningsComponent() {
  return <SettingsLearningsRoute loaderData={useLoaderData<typeof loadLearnings>()} />
}

const workspaceRoutes: RouteObject[] = [
  {
    path: "/repositories/:repositoryId/learnings",
    loader: loadLearnings,
    action: saveLearnings,
    Component: LearningsComponent,
  },
]

function learningsResponse() {
  return {
    accessDenied: false as const,
    repository: {
      id: "2001",
      nameWithOwner: "github/prototype",
      defaultBranch: "main",
    },
    capabilities: { administerHub: false, administerRepository: true as const },
    permissions: { viewEvidence: true, decide: true, requestRun: true },
    copilot: { state: "connected" as const, connectedBy: "hub-admin" },
    automaticRunsEnabled: false,
    usageCredits: "0.0945",
    runAvailable: true,
    loadError: null,
    identityReviewCount: 1,
    suggestions: [
      {
        id: "mem_suggestion",
        content: "Show a visible label above every form field.",
        reviewDigest: digest,
        support: { reviewers: 2, prototypes: 2 },
        replaces: [
          { id: "mem_old", content: "Use a label when a field is unclear." },
          { id: "mem_withheld", content: null },
        ],
        evidence: [
          {
            eventId: "evt_support",
            commentId: 17,
            body: "The email field needs a visible label.",
            authorLogin: "mona",
            authorAvatarUrl: null,
            prototypeId: "1",
            prototypeName: "Welcome",
            createdAt: "2026-11-09T20:00:00.000Z",
          },
        ],
        otherEvidenceCount: 1,
        contradictions: [
          {
            eventId: "evt_opposed",
            commentId: 18,
            body: "The existing visible labels already explain these fields.",
            authorLogin: "hubot",
            authorAvatarUrl: null,
            prototypeId: "2",
            prototypeName: "Navigation",
            createdAt: "2026-11-09T21:00:00.000Z",
          },
        ],
        otherContradictionsCount: 2,
      },
    ],
    learnings: [
      {
        id: "mem_accepted",
        content: "Use one primary button per form.",
        acceptedBy: "octocat",
        acceptedAt: "2026-11-08T20:00:00.000Z",
        edited: true,
        status: "recalled" as const,
      },
      {
        id: "mem_damaged",
        content: null,
        acceptedBy: null,
        acceptedAt: null,
        edited: false,
        status: "damaged" as const,
      },
    ],
    recall: {
      text: "Approved team learnings\n1. Use one primary button per form.",
      count: 1,
    },
    runs: [
      {
        id: 8,
        startedAt: "2026-11-10T12:00:00.000Z",
        startedBy: { type: "user" as const, login: "octocat" },
        state: "succeeded" as const,
        result: {
          type: "succeeded" as const,
          commentsConsidered: 4,
          commentsLabeled: 2,
          commentsRemaining: 1,
          suggestions: 1,
          suggestionsRemaining: 1,
        },
        usage: { credits: "0.021", requests: 1 },
      },
      {
        id: 7,
        startedAt: "2026-11-09T12:00:00.000Z",
        startedBy: { type: "daily" as const },
        state: "failed" as const,
        result: { type: "failed" as const, summary: "Copilot did not return a result." },
        usage: null,
      },
    ],
  }
}

function decisionModelOverview(evaluated: boolean) {
  const build = {
    id: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
    number: 42,
    prototypeId: "1",
  }
  return {
    preflight: {
      state: "ready" as const,
      counts: {
        prototypes: 1,
        builds: 1,
        pages: 1,
        screenshots: 4,
        questions: 1,
        samples: 3,
        tasks: 3,
        train: 1,
        dev: 1,
        test: 1,
        follows: 2,
        breaks: 1,
      },
      warnings: [],
      reasons: [],
      digests: {
        export: digest,
        reviewSnapshot: digest,
        buildSet: digest,
        questionSet: digest,
        taskset: digest,
      },
    },
    configuration: {
      enabled: true,
      generation: 3,
      backend: "fixture",
      maxUpdates: 8,
      maxSeconds: 300,
      monthlyBudgetCredits: "10",
    },
    jobs: [],
    candidates: [],
    promotion: {
      candidateId: "33333333-4444-4555-8666-777777777777",
      runtimeCandidateId: "fixture-candidate-1",
      generation: 2,
      operation: "promote" as const,
      rollbackAvailable: false,
    },
    promotionHistory: [],
    evaluationBuilds: evaluated
      ? []
      : [
          {
            id: build.id,
            number: build.number,
            prototype: {
              id: build.prototypeId,
              name: "Settings",
              branchName: "settings",
            },
          },
        ],
    evaluations: evaluated
      ? [
          {
            id: "44444444-5555-4666-8777-888888888888",
            build,
            model: {
              id: "33333333-4444-4555-8666-777777777777",
              runtimeCandidateId: "fixture-candidate-1",
              generation: 2,
            },
            questionDigest: digest,
            screenshotSetDigest: digest,
            responseDigest: digest,
            findingsAvailable: true,
            findings: [
              {
                learning: {
                  id: "learning-1",
                  text: "Use a visible label above every form field.",
                },
                route: "/settings/profile",
                views: [{ viewport: "desktop", theme: "dark" }],
                followsProbability: 0.82,
                breaksProbability: 0.18,
                explanation:
                  "The promoted model found the Build more likely to follow the learning.",
              },
            ],
            createdAt: "2026-11-20T15:00:00Z",
          },
        ]
      : [],
    deletions: [],
  }
}

function queuedDecisionModelOverview() {
  return decisionModelOverviewWithJob("queued")
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function decisionModelOverviewWithJob(state: "queued" | "running" | "succeeded") {
  return {
    ...decisionModelOverview(false),
    jobs: [
      {
        id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
        state,
        tasksetDigest: digest,
        runtimeJobId: state === "queued" ? null : "runtime-job-1",
        candidateRuntimeId: state === "succeeded" ? "fixture-candidate-2" : null,
        failureCode: null,
        createdAt: "2026-11-20T16:30:00Z",
        finishedAt: state === "succeeded" ? "2026-11-20T16:35:00Z" : null,
      },
    ],
  }
}

describe("Learnings frontend integration", () => {
  it("includes the repository in the document title", () => {
    expect(meta({ loaderData: learningsResponse() })).toEqual([
      { title: "Learnings - github/prototype - Replica Hub" },
    ])
    expect(meta({})).toEqual([{ title: "Replica Hub" }])
  })

  it("loads the dedicated contract and presents the complete repository learning history", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const requests: string[] = []
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url)
      if (url.pathname.includes("/learnings")) requests.push(`${request.method} ${url.pathname}`)
    })
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json(learningsResponse()),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(await screen.findByText("Raised by 2 reviewers on 2 prototypes")).toBeVisible()
    expect(screen.getByText("The email field needs a visible label.")).toBeInTheDocument()
    expect(
      screen.getByText("The existing visible labels already explain these fields."),
    ).toBeInTheDocument()
    expect(
      screen.getByText("2 more opposing comments that Hub cannot show here"),
    ).toBeInTheDocument()
    expect(screen.getByText("This learning's wording is not available for review.")).toBeVisible()
    expect(screen.getByText(/Accepted by @octocat .* with edits/)).toBeVisible()
    expect(
      within(
        screen.getByRole("article", {
          name: /wording is unavailable because its stored record failed integrity checks/,
        }),
      ).getByText(/agents do not get it/),
    ).toBeVisible()
    const recall = screen
      .getAllByRole("region", { name: "What an agent gets" })
      .find((region) => region.textContent?.includes("Approved team learnings"))
    if (!recall) throw new Error("The agent recall preview must be available.")
    expect(recall).toHaveTextContent("Use one primary button per form.")
    expect(screen.getByRole("cell", { name: /4 new comments, 2 labeled/ })).toBeVisible()
    expect(screen.getByRole("cell", { name: "0.021 AI credits in 1 request" })).toBeVisible()
    expect(screen.getByRole("cell", { name: /Copilot did not return a result/ })).toBeVisible()
    expect(screen.queryByRole("button", { name: /connect copilot/i })).not.toBeInTheDocument()
    expect(
      screen.getByText("Hub looks for learnings when you choose Find learnings now."),
    ).toBeVisible()
    expect(requests).toEqual(["GET /api/repositories/2001/learnings"])
  })

  it("reports daily checks only when automatic runs are enabled", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({ ...learningsResponse(), automaticRunsEnabled: true }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(
      await screen.findByText(
        "Hub looks for learnings once a day when there are new comments, using the Copilot connection @hub-admin made.",
      ),
    ).toBeVisible()
  })

  it("posts a run only to the dedicated repository endpoint", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const runRequests = vi.fn()
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json(learningsResponse()),
      ),
      http.post(`${store.origin}/api/repositories/2001/learnings/runs`, async ({ request }) => {
        runRequests({
          contentType: request.headers.get("content-type"),
          text: await request.text(),
        })
        return HttpResponse.json({ notice: "Hub will look for learnings shortly." })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings", {
      workspaceRoutes,
    })

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Find learnings now" })),
    )

    expect(runRequests).toHaveBeenCalledWith({ contentType: null, text: "" })
    expect(await screen.findByText("Hub will look for learnings shortly.")).toBeVisible()
  })

  it("evaluates an eligible Build through the route action and shows saved findings", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const evaluationRequests = vi.fn()
    let evaluated = false
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`${store.origin}/api/repositories/2001/decision-model`, () =>
        HttpResponse.json(decisionModelOverview(evaluated)),
      ),
      http.post(
        `${store.origin}/api/repositories/2001/decision-model/builds/77777777-8888-4999-8aaa-bbbbbbbbbbbb/evaluation`,
        async ({ request }) => {
          evaluationRequests({
            contentType: request.headers.get("content-type"),
            text: await request.text(),
          })
          evaluated = true
          return HttpResponse.json({
            id: "44444444-5555-4666-8777-888888888888",
            runtimeEvaluationId: "fixture-evaluation-1",
            candidateId: "fixture-candidate-1",
            generation: 2,
            responseDigest: digest,
            evaluations: [
              {
                learningId: "learning-1",
                followsProbability: 0.82,
                breaksProbability: 0.18,
              },
            ],
            usage: [],
          })
        },
      ),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings", {
      workspaceRoutes,
    })

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Evaluate Settings — Build 42" })),
    )

    expect(evaluationRequests).toHaveBeenCalledWith({ contentType: null, text: "" })
    expect(
      await screen.findByText(/promoted model found the Build more likely to follow the learning/),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Evaluate Settings — Build 42" }),
    ).not.toBeInTheDocument()
  })

  it("keeps the decision panel while an accepted training request becomes authoritative", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    let trainingAccepted = false
    let acceptedOverviewReads = 0
    const trainingRequest = deferred()
    const authoritativeOverview = deferred()
    let trainingPostCount = 0
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`${store.origin}/api/repositories/2001/decision-model`, async () => {
        if (!trainingAccepted) return HttpResponse.json(decisionModelOverview(false))
        acceptedOverviewReads += 1
        if (acceptedOverviewReads === 1) {
          return HttpResponse.json(
            { error: "Another learning operation is still running." },
            { status: 409 },
          )
        }
        await authoritativeOverview.promise
        return HttpResponse.json(queuedDecisionModelOverview())
      }),
      http.post(`${store.origin}/api/repositories/2001/decision-model/training-jobs`, async () => {
        trainingPostCount += 1
        await trainingRequest.promise
        trainingAccepted = true
        return HttpResponse.json({
          created: true,
          job: {
            id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
            state: "queued",
            runtimeJobId: null,
            candidateRuntimeId: null,
            failureCode: null,
            createdAt: "2026-11-20T16:30:00Z",
          },
        })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings", {
      workspaceRoutes,
    })

    fireEvent.click(await screen.findByRole("button", { name: "Start training" }))
    const confirm = screen.getByRole("button", { name: "Queue this training job" })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(confirm).toBeDisabled())
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled()
    expect(screen.getByText(/submitting.*training request|training request.*prepar/i)).toBeVisible()

    trainingRequest.release()

    expect(
      await screen.findByText("Training was queued within the confirmed repository budget."),
    ).toBeVisible()
    expect(await screen.findByText(/training was accepted.*preparing/i)).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "Repository training" })).toBeVisible()
    expect(
      screen.queryByText(
        "Decision-model training is temporarily unavailable: Another learning operation is still running.",
      ),
    ).not.toBeInTheDocument()

    authoritativeOverview.release()

    expect(
      await screen.findByText(
        "Queued: training is using the pinned evidence shown for this job.",
        {},
        { timeout: 5_000 },
      ),
    ).toBeVisible()
    expect(acceptedOverviewReads).toBeGreaterThanOrEqual(2)
    expect(trainingPostCount).toBe(1)
    await router.settle(() => router.revalidate())
    expect(trainingPostCount).toBe(1)
    await router.settle()
  })

  it("keeps the last running job through delayed lock retries and replaces it authoritatively", async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    let overviewReads = 0
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`${store.origin}/api/repositories/2001/decision-model`, () => {
        overviewReads += 1
        if (overviewReads === 1) {
          return HttpResponse.json(decisionModelOverviewWithJob("running"))
        }
        if (overviewReads <= 3) {
          return HttpResponse.json(
            { error: "Another learning operation is still running." },
            { status: 409 },
          )
        }
        if (overviewReads === 4) {
          return HttpResponse.json(decisionModelOverviewWithJob("succeeded"))
        }
        return HttpResponse.json(
          { error: "The decision runtime did not respond." },
          { status: 503 },
        )
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings", {
      workspaceRoutes,
    })
    const history = screen.getByRole("region", { name: "Decision-model training history" })

    expect(
      screen.getByText("Running: training is using the pinned evidence shown for this job."),
    ).toBeVisible()
    expect(within(history).getByRole("cell", { name: "Running" })).toBeVisible()
    expect(overviewReads).toBe(1)

    await router.settle(() => router.revalidate())

    const delayedStatus = screen.getByText(
      "Status refresh is delayed while Hub prepares evidence. The last confirmed job state is running.",
    )
    expect(delayedStatus).toBeVisible()
    expect(screen.getAllByText(/Status refresh is delayed/)).toHaveLength(1)
    expect(within(history).getByRole("cell", { name: "Running" })).toBeVisible()
    expect(
      screen.queryByText(
        "Decision-model training is temporarily unavailable: Another learning operation is still running.",
      ),
    ).not.toBeInTheDocument()
    expect(overviewReads).toBe(2)

    await act(async () => vi.advanceTimersByTimeAsync(749))
    expect(overviewReads).toBe(2)
    await router.settle(() => vi.advanceTimersByTimeAsync(1))

    expect(screen.getAllByText(/Status refresh is delayed/)).toEqual([delayedStatus])
    expect(within(history).getByRole("cell", { name: "Running" })).toBeVisible()
    expect(overviewReads).toBe(3)

    await router.settle(() => vi.advanceTimersByTimeAsync(5_000))

    expect(
      within(screen.getByRole("region", { name: "Decision-model training history" })).getByRole(
        "cell",
        { name: "Finished" },
      ),
    ).toBeVisible()
    expect(screen.queryByText(/Status refresh is delayed/)).not.toBeInTheDocument()
    expect(overviewReads).toBe(4)

    await router.settle(() => router.revalidate())

    expect(
      screen.getByText(
        "Decision-model training is temporarily unavailable: The decision runtime did not respond.",
      ),
    ).toBeVisible()
    expect(screen.queryByRole("region", { name: "Decision-model training history" })).toBeNull()
    expect(overviewReads).toBe(5)
  })

  it("keeps the explicit run action for a queued automatic run", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const response = learningsResponse()
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({
          ...response,
          runAvailable: true,
          runs: [
            {
              id: 9,
              startedAt: "2026-11-11T12:00:00.000Z",
              startedBy: { type: "daily" },
              state: "queued",
              result: null,
              usage: null,
            },
            ...response.runs,
          ],
        }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(await screen.findByRole("button", { name: "Find learnings now" })).toBeVisible()
    expect(screen.getByText("Hub will look for learnings shortly.")).toHaveAttribute(
      "role",
      "status",
    )
  })

  it("uses the local contract endpoints to accept a learning and refresh recall", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const requests: string[] = []
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url)
      if (request.method === "POST") requests.push(url.pathname)
    })
    const router = await renderHubFlow(server, "/repositories/2001/learnings", {
      workspaceRoutes,
    })
    const suggestion = await screen.findByRole("article", {
      name: /Show a visible label above every form field/,
    })

    const accept = within(suggestion).getByRole("button", { name: "Accept" })
    const acceptForm = accept.closest("form")
    if (!acceptForm) throw new Error("The acceptance control must belong to a form.")
    await router.settle(() => fireEvent.submit(acceptForm))

    expect(requests).toEqual([
      "/api/repositories/2001/learnings/mem_7eb35ba21bbe6c45a9a296b4/decision",
    ])
    expect(
      await screen.findByRole("article", {
        name: /Show a visible label above every form field/,
      }),
    ).toHaveTextContent("Accepted by @octocat")
    const recall = screen
      .getAllByRole("region", { name: "What an agent gets" })
      .find((region) => region.textContent?.includes("Approved team learnings"))
    if (!recall) throw new Error("The accepted learning must enter the agent recall preview.")
    expect(recall).toHaveTextContent("Show a visible label above every form field")
  })

  it("rejects a stale reviewed digest without changing Learnings state", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const before = store.learnings.get("2001")
    if (before.accessDenied) throw new Error("The owner must administer repository learnings.")
    const suggestion = before.suggestions[0]!
    const response = await fetch(
      `${store.origin}/api/repositories/2001/learnings/${suggestion.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "accept", digest: `sha256:${"b".repeat(64)}` }),
      },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "This suggestion changed. Review its current wording and evidence.",
    })
    const after = store.learnings.get("2001")
    if (after.accessDenied) throw new Error("The owner must administer repository learnings.")
    expect(after.suggestions).toEqual(before.suggestions)
    expect(after.learnings).toEqual(before.learnings)
    expect(after.recall).toEqual(before.recall)
  })

  it("refreshes a changed suggestion after a stale-digest response", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const original = learningsResponse()
    let changed = false
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json(
          changed
            ? {
                ...original,
                suggestions: original.suggestions.map((suggestion) => ({
                  ...suggestion,
                  content: "Show a persistent visible label above every form field.",
                  reviewDigest: `sha256:${"b".repeat(64)}`,
                })),
              }
            : original,
        ),
      ),
      http.post(`${store.origin}/api/repositories/2001/learnings/:learningId/decision`, () => {
        changed = true
        return HttpResponse.json(
          { error: "This suggestion changed. Review its current wording and evidence." },
          { status: 409 },
        )
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings", {
      workspaceRoutes,
    })
    const suggestion = await screen.findByRole("article", {
      name: "Show a visible label above every form field.",
    })
    fireEvent.click(within(suggestion).getByRole("button", { name: "Edit and accept" }))
    const wording = within(suggestion).getByRole("textbox", { name: "Wording agents get" })
    fireEvent.change(wording, { target: { value: "My stale draft." } })

    await router.settle(() =>
      fireEvent.click(within(suggestion).getByRole("button", { name: "Accept with this wording" })),
    )

    expect(
      await screen.findByRole("article", {
        name: "Show a persistent visible label above every form field.",
      }),
    ).toBeVisible()
    expect(screen.queryByDisplayValue("My stale draft.")).not.toBeInTheDocument()
  })

  it.each([
    {
      label: "edited acceptance",
      article: "Show a visible label above every form field.",
      open: "Edit and accept",
      textbox: "Wording agents get",
      value: "Use a visible label on every field.",
      submit: "Accept with this wording",
      expected: { decision: "accept", digest, content: "Use a visible label on every field." },
      error: "This suggestion changed. Review its current wording and evidence.",
      status: 409,
    },
    {
      label: "rejection",
      article: "Show a visible label above every form field.",
      open: "Reject",
      textbox: "Why reject this suggestion?",
      value: "The design system already covers this.",
      submit: "Reject suggestion",
      expected: {
        decision: "reject",
        digest,
        reason: "The design system already covers this.",
      },
      error: "Decisions are temporarily unavailable.",
      status: 503,
    },
    {
      label: "retirement",
      article: "Use one primary button per form.",
      open: "Retire",
      textbox: "Why retire this learning?",
      value: "This guidance no longer applies.",
      submit: "Retire learning",
      expected: { decision: "retire", reason: "This guidance no longer applies." },
      error: "Decisions are temporarily unavailable.",
      status: 503,
    },
  ])(
    "sends the exact $label input and keeps it visible when the save fails",
    async ({ article, open, textbox, value, submit, expected, error, status }) => {
      const store = createMockStore({ origin: window.location.origin })
      const server = setupServer(...createMockHandlers(store))
      const bodies: unknown[] = []
      server.use(
        http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
          HttpResponse.json(learningsResponse()),
        ),
        http.post(
          `${store.origin}/api/repositories/2001/learnings/:learningId/decision`,
          async ({ request }) => {
            bodies.push(await request.json())
            return HttpResponse.json({ error }, { status })
          },
        ),
      )
      const router = await renderHubFlow(server, "/repositories/2001/learnings", {
        workspaceRoutes,
      })
      const card = await screen.findByRole("article", { name: article })
      fireEvent.click(within(card).getByRole("button", { name: open }))
      const input = within(card).getByRole("textbox", { name: textbox })
      fireEvent.change(input, { target: { value } })

      const submitButton = within(card).getByRole("button", { name: submit })
      const form = submitButton.closest("form")
      if (!form) throw new Error("The learning decision control must belong to a form.")
      await router.settle(() => fireEvent.submit(form))

      expect(await screen.findByText(error)).toBeVisible()
      expect(input).toHaveValue(value)
      expect(bodies).toEqual([expected])
    },
  )

  it("shows access denied without exposing learning data or decision controls", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const before = store.learnings.get("2001")
    store.session.select("reader")
    const server = setupServer(...createMockHandlers(store))
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(
      await screen.findByText("You do not have permission to view this repository's learnings."),
    ).toBeVisible()
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "The email field has no label, only placeholder text that disappears when I type.",
      ),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()

    for (const request of [
      fetch(`${store.origin}/api/repositories/2001/learnings/runs`, { method: "POST" }),
      fetch(
        `${store.origin}/api/repositories/2001/learnings/mem_7eb35ba21bbe6c45a9a296b4/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "accept", digest }),
        },
      ),
    ]) {
      expect((await request).status).toBe(403)
    }
    store.session.select("owner")
    expect(store.learnings.get("2001")).toEqual(before)
  })

  it("sums all recent usage exactly instead of limiting the total to displayed runs", () => {
    const store = createMockStore({ origin: window.location.origin })
    for (let index = 0; index < 10; index += 1) store.learnings.run("2001")
    const response = store.learnings.get("2001")
    if (response.accessDenied) throw new Error("The owner must administer repository learnings.")

    expect(response.runs).toHaveLength(10)
    expect(response.usageCredits).toBe("0.21")
  })

  it("keeps Copilot connection management outside repository Learnings", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const response = learningsResponse()
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({
          ...response,
          copilot: { state: "not-connected" },
          runAvailable: false,
        }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(
      await screen.findByText("Learnings stays off until a Hub administrator connects Copilot."),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Accept" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /connect copilot/i })).not.toBeInTheDocument()
  })

  it("rejects a malformed repository identifier before requesting learnings", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const reads = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (new URL(request.url).pathname.includes("/learnings")) reads()
    })
    await renderHubFlow(server, "/repositories/not-a-repository/learnings", { workspaceRoutes })

    expect(await screen.findByRole("heading", { name: "Invalid address" })).toBeVisible()
    expect(screen.getByText("400")).toBeVisible()
    expect(reads).not.toHaveBeenCalled()
  })

  it("shows a malformed API response through the route error boundary", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({ accessDenied: false, suggestions: "not-an-array" }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(await screen.findByRole("heading", { name: "Unexpected API response" })).toBeVisible()
    expect(screen.getByText("The API returned data in an unexpected shape.")).toBeVisible()
  })

  it("shows a Learnings request failure through the route error boundary", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/repositories/2001/learnings`, () =>
        HttpResponse.json({ error: "Learnings are temporarily unavailable." }, { status: 503 }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(await screen.findByRole("heading", { name: "Unable to load Hub" })).toBeVisible()
    expect(screen.getByText("Learnings are temporarily unavailable.")).toBeVisible()
    expect(screen.getByText("503")).toBeVisible()
  })
})
