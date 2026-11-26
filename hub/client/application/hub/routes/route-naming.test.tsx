import type { RouteConfigEntry } from "@react-router/dev/routes"
import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import routeConfig from "../routes"
import { authenticatedWorkspace, workspaceViewerId } from "./fixtures/authenticated-workspace"
import { emptyLearnings } from "./fixtures/empty-learnings"
import { renderHubFlow } from "./fixtures/render-hub-flow"

const first = {
  id: "11111111-1111-4111-8111-111111111111",
  nameWithOwner: "team/alpha",
  defaultBranch: "main",
}
const second = {
  id: "22222222-2222-4222-8222-222222222222",
  nameWithOwner: "team/beta",
  defaultBranch: "main",
}
const analytics = {
  destinations: [],
  canExportHistory: false,
  outboundEnabled: true,
  canMutate: true,
}

function registeredPaths(entries: RouteConfigEntry[]): string[] {
  return entries.flatMap((entry) => [
    ...(entry.path ? [entry.path] : []),
    ...registeredPaths(entry.children ?? []),
  ])
}

describe("Hub primary route names", () => {
  it("registers the canonical URLs and sign-in compatibility redirect but no mock session route", () => {
    const paths = registeredPaths(routeConfig)
    expect(paths).toEqual(
      expect.arrayContaining([
        "repositories",
        "repositories/:repositoryId",
        "repositories/:repositoryId/new",
        "repositories/:repositoryId/analytics",
        "repositories/:repositoryId/learnings",
        "settings/sharing",
        "settings/audit",
        "settings/administrators",
        "settings/sessions",
        "settings/github/setup",
        "settings/copilot",
        "sign-in",
        "welcome",
        "notifications",
      ]),
    )
    expect(paths).not.toContain("session")
  })

  it("reads and pauses the path repository's destination despite a conflicting query", async () => {
    const path = `/repositories/${second.id}/analytics`
    const destinationId = "33333333-3333-4333-8333-333333333333"
    const pause = vi.fn()
    let enabled = true
    const api = stubHubFetch(
      ...authenticatedWorkspace([first, second]),
      http.get(`/api${path}`, () =>
        Response.json({
          ...analytics,
          destinations: [
            {
              id: destinationId,
              enabled,
              provider: "segment",
              region: "eu",
              eventTypes: ["build_published"],
              deliveryFailed: false,
            },
          ],
        }),
      ),
      http.post(`/api${path}/destinations/${destinationId}/pause`, () => {
        pause()
        enabled = false
        return Response.json({ id: destinationId })
      }),
    )
    const router = await renderHubFlow(api, `${path}?repositoryId=${first.id}`)
    expect(
      screen.getByRole("button", { name: "Choose repository. team/beta selected" }),
    ).toBeVisible()
    const destination = screen.getByRole("region", { name: "Segment" })
    expect(within(destination).getByRole("combobox", { name: "Region" })).toHaveValue("eu")
    const control = within(destination).getByRole("button", { name: "Pause" })
    const form = control.closest("form")!
    expect(new URL(form.action).pathname).toBe(path)
    const target = new URL(form.action)
    target.searchParams.set("repositoryId", first.id)
    form.action = target.href
    await router.settle(() => fireEvent.click(control))

    expect(pause).toHaveBeenCalledOnce()
    expect(await screen.findByRole("button", { name: "Resume" })).toBeEnabled()
    expect(router.state.location.pathname).toBe(path)
  })

  it("runs and accepts learnings for the path repository, not the repository hint", async () => {
    const path = `/repositories/${second.id}/learnings`
    const base = { ...emptyLearnings(), repository: second }
    const suggestion = {
      id: "mem_second",
      title: null,
      reviewDigest: `sha256:${"a".repeat(64)}`,
      content: "Use a visible form label.",
      support: { reviewers: 2, prototypes: 2 },
      replaces: [],
      evidence: [],
      otherEvidenceCount: 0,
      contradictions: [],
      otherContradictionsCount: 0,
    }
    let ran = false
    let accepted = false
    const decision = vi.fn()
    const api = stubHubFetch(
      ...authenticatedWorkspace([first, second]),
      http.get(`/api${path}`, () =>
        Response.json({
          ...base,
          suggestions: ran && !accepted ? [suggestion] : [],
          learnings: accepted
            ? [
                {
                  id: suggestion.id,
                  title: null,
                  content: suggestion.content,
                  digest: suggestion.reviewDigest,
                  acceptedBy: "octocat",
                  acceptedAt: "2026-11-20T12:00:00Z",
                  edited: false,
                  lastDecision: "accepted",
                  status: "recalled",
                },
              ]
            : [],
        }),
      ),
      http.get(`/api${path}/:learningId/history`, () =>
        Response.json({
          decisions: [],
          evidence: [],
          otherEvidenceCount: 0,
          contradictions: [],
          otherContradictionsCount: 0,
        }),
      ),
      http.post(`/api${path}/runs`, () => {
        ran = true
        return Response.json({ notice: "Learning run requested." })
      }),
      http.post(`/api${path}/${suggestion.id}/decision`, async ({ request }) => {
        decision(await request.json())
        accepted = true
        return Response.json({ notice: "Learning accepted." })
      }),
    )
    const router = await renderHubFlow(api, `${path}?repositoryId=${first.id}`)
    const run = screen.getByRole("button", { name: "Find learnings now" })
    expect(new URL(run.closest("form")!.action).pathname).toBe(`${path}/runs`)
    await router.settle(() => fireEvent.click(run))
    await router.settle(async () =>
      fireEvent.click(await screen.findByRole("link", { name: suggestion.content })),
    )
    const accept = await screen.findByRole("button", { name: "Accept learning" })
    expect(new URL(accept.closest("form")!.action).pathname).toBe(
      `${path}/${suggestion.id}/decision`,
    )
    await router.settle(() => fireEvent.click(accept))

    expect(decision).toHaveBeenCalledExactlyOnceWith({
      decision: "accept",
      digest: suggestion.reviewDigest,
    })
    expect(await screen.findByRole("button", { name: "Edit learning" })).toBeEnabled()
    expect(router.state.location.pathname).toBe(path)
  })

  it.each(["/settings/canvas", "/settings/canvas/approve"])(
    "opens Canvas connections from %s in the readable repository workspace",
    async (source) => {
      const api = stubHubFetch(
        ...authenticatedWorkspace([second, first]),
        http.get("/api/canvas/connections", () =>
          Response.json({ viewerId: workspaceViewerId, connections: [] }),
        ),
      )
      const router = await renderHubFlow(api, source)

      expect(router.state.location.pathname).toBe("/canvas/connections")
      expect(screen.getByRole("heading", { name: "Canvas connections" })).toBeVisible()
      expect(screen.getByRole("link", { name: "Back to repositories" })).toHaveAttribute(
        "href",
        `/repositories/${second.id}`,
      )
    },
  )

  it.each([
    {
      source: `/settings/analytics?repositoryId=${second.id}`,
      target: `/repositories/${second.id}/analytics`,
      hint: null,
      repositories: [first, second],
    },
    {
      source: `/settings/learnings?repositoryId=${second.id}`,
      target: `/repositories/${second.id}/learnings`,
      hint: null,
      repositories: [first, second],
    },
    {
      source: `/admin/sharing?repositoryId=${second.id}`,
      target: "/settings/sharing",
      hint: second.id,
      repositories: [first, second],
    },
    {
      source: "/settings/analytics",
      target: `/repositories/${second.id}/analytics`,
      hint: null,
      repositories: [second],
    },
    {
      source: "/settings/learnings",
      target: `/repositories/${second.id}/learnings`,
      hint: null,
      repositories: [second],
    },
  ])(
    "redirects $source to $target with the right repository context",
    async ({ source, target, hint, repositories }) => {
      const api = stubHubFetch(
        ...authenticatedWorkspace(repositories, {
          administerHub: true,
          publicSharingSettingsAvailable: true,
        }),
        target.endsWith("/analytics")
          ? http.get(`/api${target}`, () => Response.json(analytics))
          : target.endsWith("/learnings")
            ? http.get(`/api${target}`, () =>
                Response.json({ ...emptyLearnings(), repository: second }),
              )
            : http.get("/api/product/sharing-settings", () =>
                Response.json({ enabled: true, canAdminister: true, activeLinkCount: 0 }),
              ),
      )
      const entry = new URL(source, window.location.origin)
      entry.searchParams.set("q", "retained")
      const router = await renderHubFlow(api, `${entry.pathname}${entry.search}`)

      expect(router.state.location.pathname).toBe(target)
      const search = new URLSearchParams(router.state.location.search)
      expect(search.get("q")).toBe("retained")
      expect(search.get("repositoryId")).toBe(hint)
      expect(
        screen.getByRole("button", { name: "Choose repository. team/beta selected" }),
      ).toBeVisible()
    },
  )

  it.each([
    {
      entry: `/repositories/not-a-repository/analytics?repositoryId=${first.id}`,
      status: 404,
      repositories: [first],
    },
    {
      entry: `/repositories/${second.id}/learnings?repositoryId=${first.id}`,
      status: 404,
      repositories: [first],
    },
    {
      entry: "/settings/analytics?repositoryId=not-a-repository",
      status: 400,
      repositories: [first],
    },
    { entry: `/settings/learnings?repositoryId=${second.id}`, status: 404, repositories: [first] },
    { entry: "/settings/not-connected", status: 404, repositories: [first] },
    { entry: "/settings/analytics", status: 404, repositories: [] },
  ])(
    "rejects $entry with $status instead of selecting another repository",
    async ({ entry, repositories, status }) => {
      const api = stubHubFetch(
        ...authenticatedWorkspace(repositories),
        ...(entry.startsWith(`/repositories/${second.id}/learnings`)
          ? [
              http.get(`/api/repositories/${second.id}/learnings`, () =>
                Response.json({ error: "Repository not found." }, { status: 404 }),
              ),
            ]
          : []),
      )
      await renderHubFlow(api, entry)
      expect(screen.getByText(String(status), { exact: true })).toBeVisible()
    },
  )
})
