import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { emptyLearnings } from "./fixtures/empty-learnings"
import { renderHubFlow } from "./fixtures/render-hub-flow"
import { meta } from "./settings-learnings"

const digest = `sha256:${"a".repeat(64)}`

function learningsWorkspace() {
  const { repository } = emptyLearnings()
  return authenticatedWorkspace([
    repository,
    { ...repository, id: "2002", nameWithOwner: "github/empty" },
  ])
}

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
        title: null,
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
        title: null,
        content: "Use one primary button per form.",
        digest,
        acceptedBy: "octocat",
        acceptedAt: "2026-11-08T20:00:00.000Z",
        edited: true,
        lastDecision: "accepted",
        status: "recalled" as const,
      },
      {
        id: "mem_damaged",
        title: null,
        content: null,
        digest: null,
        acceptedBy: null,
        acceptedAt: null,
        edited: false,
        lastDecision: "accepted",
        status: "damaged" as const,
      },
    ],
    rejected: [],
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

function emptyHistory() {
  return http.get("/api/repositories/2001/learnings/:learningId/history", () =>
    Response.json({
      decisions: [],
      evidence: [],
      otherEvidenceCount: 0,
      contradictions: [],
      otherContradictionsCount: 0,
    }),
  )
}

async function submitDialog(open: string, fields: Record<string, string>, submit: string) {
  fireEvent.click(await screen.findByRole("button", { name: open }))
  for (const [name, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } })
  }
  const form = within(screen.getByRole("dialog"))
    .getByRole("button", { name: submit })
    .closest("form")
  if (!form) throw new Error("The learning decision control must belong to a form.")
  return form
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

  it("lists suggestions first with recall and runs, without loading any history", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    server.use(
      http.get(`/api/repositories/2001/learnings`, () => Response.json(learningsResponse())),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(
      await screen.findByRole("link", { name: "Show a visible label above every form field." }),
    ).toHaveAttribute(
      "href",
      "/repositories/2001/learnings?status=suggested&learning=mem_suggestion",
    )
    expect(screen.getByRole("link", { name: /Active\s*2/ })).toBeVisible()
    const recall = screen
      .getAllByRole("region", { name: "What an agent gets" })
      .find((region) => region.textContent?.includes("Approved team learnings"))
    if (!recall) throw new Error("The agent recall preview must be available.")
    expect(recall).toHaveTextContent("Use one primary button per form.")
    expect(screen.getByRole("cell", { name: /4 new comments, 2 labeled/ })).toBeVisible()
    expect(screen.getByRole("cell", { name: /Copilot did not return a result/ })).toBeVisible()
    expect(screen.queryByRole("button", { name: /connect copilot/i })).not.toBeInTheDocument()
    expect(
      server.requests
        .map(({ method, url }) => `${method} ${new URL(url).pathname}`)
        .filter((request) => request.includes("/learnings")),
    ).toEqual(["GET /api/repositories/2001/learnings"])
  })

  it("opens a learning with its evidence, replacements, and decision history", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    server.use(
      http.get(`/api/repositories/2001/learnings`, () => Response.json(learningsResponse())),
      http.get("/api/repositories/2001/learnings/mem_accepted/history", () =>
        Response.json({
          decisions: [
            {
              version: 1,
              state: "accepted",
              change: "accepted",
              by: "octocat",
              at: "2026-11-08T20:00:00.000Z",
              reason: null,
            },
          ],
          evidence: [],
          otherEvidenceCount: 3,
          contradictions: [],
          otherContradictionsCount: 0,
        }),
      ),
      emptyHistory(),
    )
    const router = await renderHubFlow(
      server,
      "/repositories/2001/learnings?learning=mem_suggestion",
    )

    expect(await screen.findByText("Raised by 2 reviewers on 2 prototypes")).toBeVisible()
    expect(screen.getByText("The email field needs a visible label.")).toBeVisible()
    expect(screen.getByRole("region", { name: "What reviewers disagreed with" })).toHaveTextContent(
      "2 more opposing comments that Hub cannot show here",
    )
    expect(screen.getByRole("region", { name: "Accepting this replaces" })).toHaveTextContent(
      "This learning's wording is not available for review.",
    )
    expect(screen.queryByRole("cell", { name: /4 new comments/ })).not.toBeInTheDocument()

    await router.settle(() => router.navigate("/repositories/2001/learnings?learning=mem_accepted"))

    expect(await screen.findByText(/Accepted by @octocat .* with edits/)).toBeVisible()
    expect(screen.getByRole("region", { name: "Decision history" })).toHaveTextContent(
      "Accepted by @octocat",
    )
    expect(screen.getByText("3 more comments that Hub cannot show here")).toBeVisible()
  })

  it("reports daily checks only when automatic runs are enabled", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({ ...learningsResponse(), automaticRunsEnabled: true }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(
      await screen.findByText(
        "Hub looks for learnings once a day when there are new comments, using the Copilot connection @hub-admin made.",
      ),
    ).toBeVisible()
  })

  it("shows migration redaction follow-ups to the repository administrator after reload", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const notice =
      "Rebuild learning mem_111111111111111111111111. Follow up on export exp_222222222222222222222222 at private/exports/team.json."
    let loads = 0
    server.use(
      http.get("/api/repositories/2001/learnings", () => {
        loads++
        return Response.json({
          ...learningsResponse(),
          loadError: notice,
        })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings")

    expect(await screen.findByText(notice)).toBeVisible()
    await router.settle(() => router.revalidate())
    expect(loads).toBe(2)
    expect(screen.getByText(notice)).toBeVisible()
  })

  it("posts a run only to the dedicated repository endpoint", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const runRequests = vi.fn()
    server.use(
      http.get(`/api/repositories/2001/learnings`, () => Response.json(learningsResponse())),
      http.post(`/api/repositories/2001/learnings/runs`, async ({ request }) => {
        runRequests({
          contentType: request.headers.get("content-type"),
          text: await request.text(),
        })
        return Response.json({ notice: "Hub will look for learnings shortly." })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings")

    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Find learnings now" })),
    )

    expect(runRequests).toHaveBeenCalledWith({ contentType: null, text: "" })
    expect(await screen.findByText("Hub will look for learnings shortly.")).toBeVisible()
  })

  it("evaluates an eligible Build through the route action and shows saved findings", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const evaluationRequests = vi.fn()
    let evaluated = false
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`/api/repositories/2001/decision-model`, () =>
        Response.json(decisionModelOverview(evaluated)),
      ),
      http.post(
        `/api/repositories/2001/decision-model/builds/77777777-8888-4999-8aaa-bbbbbbbbbbbb/evaluation`,
        async ({ request }) => {
          evaluationRequests({
            contentType: request.headers.get("content-type"),
            text: await request.text(),
          })
          evaluated = true
          return Response.json({
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
    const router = await renderHubFlow(server, "/repositories/2001/learnings")

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
    const server = stubHubFetch(...learningsWorkspace())
    let trainingAccepted = false
    let acceptedOverviewReads = 0
    let failAfterFinished = false
    const trainingRequest = deferred()
    onTestFinished(trainingRequest.release)
    let trainingPostCount = 0
    let trainingJobReads = 0
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`/api/repositories/2001/decision-model`, () => {
        if (!trainingAccepted) return Response.json(decisionModelOverview(false))
        acceptedOverviewReads += 1
        if (failAfterFinished) {
          return Response.json(
            { error: "Another learning operation is still running." },
            { status: 409 },
          )
        }
        if (acceptedOverviewReads > 1) {
          return Response.json(decisionModelOverviewWithJob("succeeded"))
        }
        return Response.json(
          { error: "Another learning operation is still running." },
          { status: 409 },
        )
      }),
      http.get(
        `/api/repositories/2001/decision-model/training-jobs/99999999-aaaa-4bbb-8ccc-dddddddddddd`,
        () => {
          trainingJobReads += 1
          return Response.json(
            decisionModelOverviewWithJob(trainingJobReads === 1 ? "running" : "succeeded").jobs[0],
          )
        },
      ),
      http.post(`/api/repositories/2001/decision-model/training-jobs`, async () => {
        trainingPostCount += 1
        await trainingRequest.promise
        trainingAccepted = true
        return Response.json({
          created: true,
          job: {
            id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
            state: "queued",
            tasksetDigest: digest,
            runtimeJobId: null,
            candidateRuntimeId: null,
            failureCode: null,
            createdAt: "2026-11-20T16:30:00Z",
            finishedAt: null,
          },
        })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings")

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
    expect(screen.getByRole("checkbox", { name: "Repository training" })).toBeVisible()
    expect(
      screen.queryByText(
        "Decision-model training is temporarily unavailable: Another learning operation is still running.",
      ),
    ).not.toBeInTheDocument()

    expect(
      await within(
        screen.getByRole("region", { name: "Decision-model training history" }),
      ).findByRole("cell", { name: "Queued" }),
    ).toBeVisible()
    expect(acceptedOverviewReads).toBeGreaterThanOrEqual(1)
    await waitFor(() => expect(trainingJobReads).toBeGreaterThanOrEqual(1))
    expect(
      await within(
        screen.getByRole("region", { name: "Decision-model training history" }),
      ).findByRole("cell", { name: "Running" }),
    ).toBeVisible()
    expect(trainingPostCount).toBe(1)
    await waitFor(() => expect(trainingJobReads).toBeGreaterThanOrEqual(2), { timeout: 4_000 })
    expect(await screen.findByRole("cell", { name: "Finished" }, { timeout: 4_000 })).toBeVisible()
    failAfterFinished = true
    await router.settle(() => router.revalidate())
    expect(trainingPostCount).toBe(1)
    expect(
      screen.getByText(
        "Decision-model training is temporarily unavailable: Another learning operation is still running.",
      ),
    ).toBeVisible()
    expect(screen.queryByText(/Training was accepted/)).not.toBeInTheDocument()
  })

  it("shows an uncorrelated learning lock instead of attributing it to a running job", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    let overviewReads = 0
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`/api/repositories/2001/decision-model`, () => {
        overviewReads += 1
        if (overviewReads === 1) {
          return Response.json(decisionModelOverviewWithJob("running"))
        }
        return Response.json(
          { error: "Another learning operation is still running." },
          { status: 409 },
        )
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings")

    expect(
      screen.getByText("Running: training is using the pinned evidence shown for this job."),
    ).toBeVisible()
    expect(overviewReads).toBe(1)

    await router.settle(() => router.revalidate())

    expect(
      screen.getByText(
        "Decision-model training is temporarily unavailable: Another learning operation is still running.",
      ),
    ).toBeVisible()
    expect(overviewReads).toBe(2)
    expect(screen.queryByRole("region", { name: "Decision-model training history" })).toBeNull()
  })

  it("does not carry a cached training job into another repository", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    server.use(
      http.get(`/api/repositories/:repositoryId/learnings`, ({ params }) =>
        Response.json({
          ...learningsResponse(),
          repository: {
            ...learningsResponse().repository,
            id: String(params.repositoryId),
            nameWithOwner: params.repositoryId === "2001" ? "github/prototype" : "github/empty",
          },
          capabilities: { administerHub: true, administerRepository: true },
        }),
      ),
      http.get(`/api/repositories/2001/decision-model`, () =>
        Response.json(decisionModelOverviewWithJob("running")),
      ),
      http.get(`/api/repositories/2002/decision-model`, () =>
        Response.json({ error: "Another learning operation is still running." }, { status: 409 }),
      ),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings")

    expect(
      await screen.findByText("Running: training is using the pinned evidence shown for this job."),
    ).toBeVisible()

    await router.settle(() => router.navigate("/repositories/2002/learnings"))

    expect(
      await screen.findByText(
        "Decision-model training is temporarily unavailable: Another learning operation is still running.",
      ),
    ).toBeVisible()
    expect(
      screen.queryByText("Running: training is using the pinned evidence shown for this job."),
    ).not.toBeInTheDocument()
  })

  it("keeps the explicit run action for a queued automatic run", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const response = learningsResponse()
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({
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
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(await screen.findByRole("button", { name: "Find learnings now" })).toBeVisible()
    expect(screen.getByText("Hub will look for learnings shortly.")).toHaveAttribute(
      "role",
      "status",
    )
  })

  it("accepts a suggestion and keeps it open as an active learning", async () => {
    const original = learningsResponse()
    const suggestionRecord = original.suggestions[0]!
    const decision = vi.fn()
    let accepted = false
    const server = stubHubFetch(
      ...learningsWorkspace(),
      http.get("/api/repositories/2001/learnings", () =>
        Response.json(
          accepted
            ? {
                ...original,
                suggestions: [],
                learnings: [
                  {
                    id: suggestionRecord.id,
                    title: null,
                    content: suggestionRecord.content,
                    digest,
                    acceptedBy: "octocat",
                    acceptedAt: "2026-11-10T12:00:00Z",
                    edited: false,
                    lastDecision: "accepted",
                    status: "recalled",
                  },
                ],
              }
            : original,
        ),
      ),
      emptyHistory(),
      http.post(
        `/api/repositories/2001/learnings/${suggestionRecord.id}/decision`,
        async ({ request }) => {
          decision(await request.json())
          accepted = true
          return Response.json({ notice: "Learning accepted." })
        },
      ),
    )
    const router = await renderHubFlow(
      server,
      `/repositories/2001/learnings?learning=${suggestionRecord.id}`,
    )
    const acceptForm = (await screen.findByRole("button", { name: "Accept learning" })).closest(
      "form",
    )
    if (!acceptForm) throw new Error("The acceptance control must belong to a form.")
    await router.settle(() => fireEvent.submit(acceptForm))

    expect(decision).toHaveBeenCalledExactlyOnceWith({ decision: "accept", digest })
    expect(await screen.findByText("Agents get this learning.")).toBeVisible()
    expect(screen.getByRole("button", { name: "Edit learning" })).toBeVisible()
  })

  it("shows a changed suggestion's current wording after a stale-digest response", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const original = learningsResponse()
    let changed = false
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json(
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
      emptyHistory(),
      http.post(`/api/repositories/2001/learnings/:learningId/decision`, () => {
        changed = true
        return Response.json(
          { error: "This suggestion changed. Review its current wording and evidence." },
          { status: 409 },
        )
      }),
    )
    const router = await renderHubFlow(
      server,
      "/repositories/2001/learnings?learning=mem_suggestion",
    )
    const form = await submitDialog(
      "Reject suggestion",
      { "Why reject it?": "My stale reason." },
      "Reject suggestion",
    )
    await router.settle(() => fireEvent.submit(form))

    expect(
      await screen.findByText("This suggestion changed. Review its current wording and evidence."),
    ).toBeVisible()
    expect(
      screen.getByRole("heading", {
        name: "Show a persistent visible label above every form field.",
      }),
    ).toBeVisible()
    expect(screen.queryByDisplayValue("My stale reason.")).not.toBeInTheDocument()
  })

  it("sends the exact edit and keeps it visible when the save fails", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const bodies: unknown[] = []
    server.use(
      http.get(`/api/repositories/2001/learnings`, () => Response.json(learningsResponse())),
      emptyHistory(),
      http.post(`/api/repositories/2001/learnings/:learningId/decision`, async ({ request }) => {
        bodies.push(await request.json())
        return Response.json({ error: "Decisions are temporarily unavailable." }, { status: 503 })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings?learning=mem_accepted")
    const form = await submitDialog(
      "Edit learning",
      {
        Title: "One primary button",
        Guidance: "Use one primary button per form, named for its action.",
        "Why change it?": "Say what to name it.",
      },
      "Save changes",
    )
    await router.settle(() => fireEvent.submit(form))

    expect(await screen.findByText("Decisions are temporarily unavailable.")).toBeVisible()
    expect(screen.getByRole("textbox", { name: "Why change it?" })).toHaveValue(
      "Say what to name it.",
    )
    expect(bodies).toEqual([
      {
        decision: "edit",
        digest,
        title: "One primary button",
        content: "Use one primary button per form, named for its action.",
        reason: "Say what to name it.",
      },
    ])
  })

  it("sends the exact rejection of an active learning without a digest", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const bodies: unknown[] = []
    server.use(
      http.get(`/api/repositories/2001/learnings`, () => Response.json(learningsResponse())),
      emptyHistory(),
      http.post(`/api/repositories/2001/learnings/:learningId/decision`, async ({ request }) => {
        bodies.push(await request.json())
        return Response.json({ error: "Decisions are temporarily unavailable." }, { status: 503 })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings?learning=mem_accepted")
    const form = await submitDialog(
      "Reject learning",
      { "Why reject it?": "This guidance no longer applies." },
      "Reject learning",
    )
    await router.settle(() => fireEvent.submit(form))

    expect(await screen.findByText("Decisions are temporarily unavailable.")).toBeVisible()
    expect(bodies).toEqual([{ decision: "retire", reason: "This guidance no longer applies." }])
  })

  it("accepts a rejected learning again with the digest and a reason", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const bodies: unknown[] = []
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({
          ...learningsResponse(),
          rejected: [
            {
              id: "mem_rejected",
              title: "Open links in a new tab",
              content: "Open every link in a new tab.",
              digest,
              state: "rejected",
              decidedBy: "hubot",
              decidedAt: "2026-11-08T20:00:00.000Z",
              reason: "It breaks the back button.",
            },
          ],
        }),
      ),
      emptyHistory(),
      http.post(`/api/repositories/2001/learnings/:learningId/decision`, async ({ request }) => {
        bodies.push(await request.json())
        return Response.json({ error: "Decisions are temporarily unavailable." }, { status: 503 })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/learnings?learning=mem_rejected")
    expect(await screen.findByText("It breaks the back button.")).toBeVisible()
    const form = await submitDialog(
      "Accept learning",
      { "Why accept it now?": "External links only." },
      "Accept learning",
    )
    await router.settle(() => fireEvent.submit(form))

    expect(await screen.findByText("Decisions are temporarily unavailable.")).toBeVisible()
    expect(bodies).toEqual([{ decision: "reinstate", digest, reason: "External links only." }])
  })

  it("shows a Hub administrator without repository authority a read-only library", async () => {
    const server = stubHubFetch(
      ...learningsWorkspace(),
      http.get("/api/repositories/2001/learnings", () =>
        Response.json({
          ...learningsResponse(),
          capabilities: { administerHub: true, administerRepository: false },
          permissions: { viewEvidence: true, decide: false, requestRun: false },
          usageCredits: null,
          runAvailable: false,
          runs: [],
        }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(await screen.findByRole("heading", { name: "Browse learnings" })).toBeVisible()
    expect(screen.queryByRole("heading", { name: "Recent runs" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
  })

  it("shows access denied without exposing learning data or decision controls", async () => {
    const server = stubHubFetch(
      ...learningsWorkspace(),
      http.get("/api/repositories/2001/learnings", () =>
        Response.json({
          accessDenied: true,
          repository: emptyLearnings().repository,
          capabilities: { administerHub: false, administerRepository: false },
        }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(
      await screen.findByText("You do not have permission to view this repository's learnings."),
    ).toBeVisible()
    expect(screen.queryByRole("navigation", { name: "Learning status" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()
  })

  it("keeps Copilot connection management outside repository Learnings", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    const response = learningsResponse()
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({
          ...response,
          copilot: { state: "not-connected" },
          runAvailable: false,
        }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(
      await screen.findByText("Learnings stays off until a Hub administrator connects Copilot."),
    ).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Show a visible label above every form field." }),
    ).toBeVisible()
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /connect copilot/i })).not.toBeInTheDocument()
  })

  it("rejects a malformed repository identifier before requesting learnings", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    await renderHubFlow(server, "/repositories/not-a-repository/learnings")

    expect(await screen.findByRole("heading", { name: "Invalid address" })).toBeVisible()
    expect(screen.getByText("400")).toBeVisible()
    expect(server.requests.some(({ url }) => new URL(url).pathname.includes("/learnings"))).toBe(
      false,
    )
  })

  it("shows a malformed API response through the route error boundary", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({ accessDenied: false, suggestions: "not-an-array" }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(await screen.findByRole("heading", { name: "Unexpected API response" })).toBeVisible()
    expect(screen.getByText("The API returned data in an unexpected shape.")).toBeVisible()
  })

  it("shows a Learnings request failure through the route error boundary", async () => {
    const server = stubHubFetch(...learningsWorkspace())
    server.use(
      http.get(`/api/repositories/2001/learnings`, () =>
        Response.json({ error: "Learnings are temporarily unavailable." }, { status: 503 }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/learnings")

    expect(await screen.findByRole("heading", { name: "Unable to load Hub" })).toBeVisible()
    expect(screen.getByText("Learnings are temporarily unavailable.")).toBeVisible()
    expect(screen.getByText("503")).toBeVisible()
  })
})
