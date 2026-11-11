import { fireEvent, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import SettingsLearningsRoute, {
  clientAction as saveLearnings,
  clientLoader as loadLearnings,
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
    canAdministerHub: false,
    permissions: { decide: true, requestRun: true },
    copilot: { state: "connected" as const, connectedBy: "hub-admin" },
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

describe("Learnings frontend integration", () => {
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
    expect(requests).toEqual(["GET /api/repositories/2001/learnings"])
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
    store.session.select("reader")
    const server = setupServer(...createMockHandlers(store))
    await renderHubFlow(server, "/repositories/2001/learnings", { workspaceRoutes })

    expect(
      await screen.findByText("You do not have permission to view this repository's learnings."),
    ).toBeVisible()
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
    expect(screen.queryByText("The email field needs a visible label.")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Find learnings now" })).not.toBeInTheDocument()
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
