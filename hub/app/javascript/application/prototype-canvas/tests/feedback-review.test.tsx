import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { publicationHub, publicationState } from "@utils/resolve-prototype-publication/fixtures"
import type { HubStatus } from "@utils/prototype-canvas/types"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."

const config = { name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }
const maintainerHub: HubStatus = {
  ...publicationHub,
  repositoryAuthorized: true,
  canReviewFeedback: true,
}
const displayedTarget = {
  repository: publicationHub.repository,
  branch: publicationHub.branch,
  hubOrigin: publicationHub.hubOrigin,
}

// Routes feedback review requests to the case and everything else to the shared canvas fixture.
function feedbackFixture(
  hub: HubStatus,
  review = () => Promise.resolve(Response.json({ requested: true })),
) {
  const { fixture, fetch: canvasFetch } = sharingFixture(publicationState, hub)
  const reviews: { body: unknown; token: unknown }[] = []
  const fetch = vi.fn((path: string, options?: RequestInit) => {
    if (path !== "/api/hub/feedback-review") return canvasFetch(path, options)
    if (options?.method !== "POST" || typeof options.body !== "string")
      throw new Error("Expected a JSON POST.")
    reviews.push({
      body: JSON.parse(options.body) as unknown,
      token: new Headers(options.headers).get("X-Replica-Canvas-Token"),
    })
    return review()
  })
  vi.stubGlobal("fetch", fetch)
  return { fixture, reviews, canvasFetch }
}

function improveContextItem() {
  const more = screen.queryByRole("button", { name: "More actions" })
  if (!more) return null
  fireEvent.click(more)
  const item = screen.queryByRole("menuitem", { name: "Improve context" })
  if (!item) fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
  return item
}

async function settleHub(canvasFetch: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(canvasFetch).toHaveBeenCalledWith("/api/hub/open", expect.anything()))
  await act(() => Promise.resolve())
}

describe("App() feedback review", () => {
  it.each([
    ["an older Hub without the capability", { ...publicationHub, repositoryAuthorized: true }],
    ["a writer", { ...maintainerHub, canReviewFeedback: false }],
    [
      "a disconnected canvas",
      { state: "disconnected", ...displayedTarget, discovery: publicationHub.discovery },
    ],
  ] satisfies [string, HubStatus][])("hides Improve context for %s", async (_label, hub) => {
    const { canvasFetch } = feedbackFixture(hub)
    const view = render(<App config={config} />)
    await settleHub(canvasFetch)

    expect(improveContextItem()).toBeNull()
    view.unmount()
  })

  it("requests a review of the displayed target once and reports when chat takes over", async () => {
    const answers: ((response: Response) => void)[] = []
    const { reviews, canvasFetch } = feedbackFixture(
      maintainerHub,
      () => new Promise<Response>((resolve) => answers.push(resolve)),
    )
    const view = render(<App config={config} />)
    await settleHub(canvasFetch)

    const item = improveContextItem()
    if (!item) throw new Error("Expected Improve context for a maintainer.")
    fireEvent.click(item)
    const more = await screen.findByRole("button", { name: "More actions" })
    await waitFor(() => expect(reviews).toHaveLength(1))
    const again = improveContextItem()
    if (again) fireEvent.click(again)
    expect(more.matches(":disabled, [aria-disabled='true']")).toBe(true)
    expect(reviews).toEqual([{ body: displayedTarget, token: "local" }])
    expect(screen.queryByText(/feedback review requested/i)).toBeNull()

    await act(async () => {
      answers[0]?.(Response.json({ requested: true }))
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((status) => /feedback review requested/i.test(status.textContent ?? "")),
      ).toBe(true),
    )
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toBeEnabled())
    expect(reviews).toHaveLength(1)
    view.unmount()
  })

  it("shows Hub's refusal and offers the action again", async () => {
    const error = "Reviewing repository feedback requires GitHub Admin or Maintain access."
    const { reviews, canvasFetch } = feedbackFixture(maintainerHub, () =>
      Promise.resolve(Response.json({ error }, { status: 403 })),
    )
    const view = render(<App config={config} />)
    await settleHub(canvasFetch)

    const item = improveContextItem()
    if (!item) throw new Error("Expected Improve context for a maintainer.")
    fireEvent.click(item)

    expect(await screen.findByRole("alert")).toHaveTextContent(error)
    expect(reviews).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toBeEnabled())
    view.unmount()
  })

  it("withdraws Improve context once Hub no longer verifies the connection", async () => {
    const { fixture, canvasFetch } = feedbackFixture(maintainerHub)
    const view = render(<App config={config} />)
    await settleHub(canvasFetch)
    expect(improveContextItem()).not.toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

    fixture.hub = { state: "disconnected", ...displayedTarget, discovery: publicationHub.discovery }
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument(),
    )
    view.unmount()
  })
})
