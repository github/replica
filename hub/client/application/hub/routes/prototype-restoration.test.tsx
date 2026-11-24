import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { previewHandlers } from "./fixtures/preview-handlers"
import { previewRecords } from "./fixtures/preview-records"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function servePreview(data: ReturnType<typeof previewRecords>) {
  return stubHubFetch(
    ...authenticatedWorkspace([data.repository]),
    ...previewHandlers(data),
    http.get(`/api${data.galleryPath}/create/permission`, () => Response.json({ canCreate: true })),
    http.get(`/api${data.path}/review-comments`, () =>
      Response.json({ comments: [], nextCursor: null, hasMore: false }),
    ),
  )
}

describe("Hub retained prototype interactions", () => {
  it("loads and restores a minimized preview with its pinned Build and saved URL state", async () => {
    const api = servePreview(previewRecords())
    const search = new URLSearchParams({
      build: "1",
      view: "minimized",
      return_path: "/welcome?step=2#heading",
      "rc.workspace.showDescription": "false",
    })
    const router = await renderHubFlow(api, `/repositories/2001/prototypes/1?${search}`)

    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Maximize Hub UI" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Welcome" })).not.toBeInTheDocument()

    await router.settle(() => router.navigate("/repositories/2001/prototypes/1/builds"))
    await router.go(-1)

    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Maximize Hub UI" })).toBeInTheDocument()
    const restored = new URLSearchParams(router.state.location.search)
    expect(Object.fromEntries(restored)).toEqual(Object.fromEntries(search))
  })

  it("lets a reader use the real Controls overlay and retains its state across Builds", async () => {
    const reader = previewRecords({ canEdit: false, canBranch: false })
    const router = await renderHubFlow(servePreview(reader), `${reader.path}?build=3`)
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))

    const controls = screen.getByRole("button", { name: "Controls" })
    expect(controls).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(controls)
    fireEvent.click(await screen.findByRole("button", { name: "Collapse controls" }))
    expect(controls).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(controls)
    expect(screen.queryByRole("button", { name: "Expand controls" })).not.toBeInTheDocument()

    await router.settle(() => router.navigate("/repositories/2001/prototypes/1?build=1"))

    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(await screen.findByRole("button", { name: "Expand controls" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Controls" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  it("does not reopen a dismissed introduction when returning to another Build of the prototype", async () => {
    const data = previewRecords()
    const router = await renderHubFlow(servePreview(data), `${data.path}?build=3`)
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))

    await router.settle(() => router.navigate("/repositories/2001/prototypes/1/builds"))
    await router.settle(() => router.navigate("/repositories/2001/prototypes/1?build=1"))

    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Welcome" })).not.toBeInTheDocument()
  })

  it("uses only the viewed pathname in the branch prompt while preserving the pinned Build and route", async () => {
    const api = servePreview(previewRecords())
    const route = { pathname: "/welcome", search: "?step=2", hash: "#heading" }
    const router = await renderHubFlow(api, "/repositories/2001/prototypes/1?build=1")
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
    fireEvent.click(screen.getByRole("button", { name: "Branch from here" }))
    const brief = screen.getByRole("textbox", { name: "What changes would you like to make?" })
    expect(brief).toHaveFocus()
    expect(screen.getByRole("button", { name: "Branch from: Welcome" })).toBeInTheDocument()
    fireEvent.change(brief, { target: { value: "Make the first step easier." } })
    const frame = screen.getByTitle<HTMLIFrameElement>("Welcome, Build 1 preview")
    await router.settle(() => {
      fireEvent.load(frame)
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: new URL(frame.src).origin,
          source: frame.contentWindow,
          data: {
            protocolVersion: 1,
            requestId: "viewed-page",
            type: "replica:bridge:ready",
            payload: { route },
          },
        }),
      )
    })
    expect(screen.getByRole("textbox", { name: "Preview URL" })).toHaveValue(
      new URL(`${route.pathname}${route.search}${route.hash}`, frame.src).href,
    )
    fireEvent.click(screen.getByRole("button", { name: "Start from this prototype" }))

    const dialog = await screen.findByRole("dialog", { name: "Continue in Copilot app" })
    const open = within(dialog).getByRole<HTMLAnchorElement>("link", {
      name: /open copilot app/i,
    })
    const destination = new URL(open.href).searchParams.get("open")
    if (!destination) throw new Error("The Copilot link must contain its app destination.")
    const session = new URL(destination)
    const prompt = session.searchParams.get("prompt")
    expect(session.searchParams.get("repo")).toBe("github/prototype")
    expect(session.searchParams.get("base_branch")).toBe("prototype/welcome")
    expect(prompt).toContain("Make the first step easier.")
    expect(prompt).toContain('route "/welcome"')
    expect(prompt).not.toContain(route.search)
    expect(prompt).not.toContain(route.hash)
    expect(prompt).toContain("Create a new branch")
    expect(prompt).toContain("`prototype/welcome`")
    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get("build")).toBe("1")
    expect(router.state.location.pathname).toBe("/repositories/2001/prototypes/1")
  })

  it("allows a creator to branch without any Build while omitting unavailable preview Controls", async () => {
    const data = previewRecords({ prototypeId: "3", name: "Settings" })
    data.prototype.builds = []
    data.prototype.latestBuild = null
    data.selectedBuild = null
    await renderHubFlow(servePreview(data), data.path)
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))

    expect(document.querySelector("iframe")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Controls" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Branch from here" }))
    expect(
      screen.getByRole("textbox", { name: "What changes would you like to make?" }),
    ).toHaveFocus()
    expect(screen.getByRole("button", { name: "Branch from: Settings" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start from this prototype" })).toBeDisabled()
  })
})
