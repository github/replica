import { fireEvent, screen, within } from "@testing-library/react"
import { setupServer } from "msw/node"
import { describe, expect, it } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub retained prototype interactions", () => {
  it("loads and restores a minimized preview with its pinned Build and saved URL state", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const search = new URLSearchParams({
      build: "1",
      view: "minimized",
      return_path: "/welcome?step=2#heading",
      "rc.workspace.showDescription": "false",
    })
    const router = await renderHubFlow(server, `/repositories/2001/prototypes/1?${search}`)

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
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("reader")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1?build=3")
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
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1?build=3")
    expect(screen.getByRole("dialog", { name: "Welcome" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))

    await router.settle(() => router.navigate("/repositories/2001/prototypes/1/builds"))
    await router.settle(() => router.navigate("/repositories/2001/prototypes/1?build=1"))

    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Welcome" })).not.toBeInTheDocument()
  })

  it("branches from the source branch and viewed page while preserving the pinned Build", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const viewedRoute = "/welcome?step=2#heading"
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1?build=1")
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
            payload: { route: { pathname: "/welcome", search: "?step=2", hash: "#heading" } },
          },
        }),
      )
    })
    fireEvent.click(screen.getByRole("button", { name: "Start from this prototype" }))

    const dialog = screen.getByRole("dialog", { name: "Continue in Copilot app" })
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
    expect(prompt).toContain(viewedRoute)
    expect(prompt).toContain("Create a new branch")
    expect(prompt).toContain("`prototype/welcome`")
    expect(screen.getByTitle("Welcome, Build 1 preview")).toBeInTheDocument()
    expect(new URLSearchParams(router.state.location.search).get("build")).toBe("1")
    expect(router.state.location.pathname).toBe("/repositories/2001/prototypes/1")
  })

  it("allows a creator to branch without any Build while omitting unavailable preview Controls", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    await renderHubFlow(server, "/repositories/2001/prototypes/3")
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
