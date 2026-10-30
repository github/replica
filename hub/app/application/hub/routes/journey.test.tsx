import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { renderHubFlow } from "./test-fixture"

describe("Hub repository journey", () => {
  it("restores applied search, author, page and view state through back navigation", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001?q=prototype&page=2&view=list")
    const results = await screen.findByRole("region", { name: "Prototypes" })
    expect(within(results).getByRole("link", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveValue("prototype")
    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked()

    await router.settle(() => fireEvent.click(screen.getByRole("button", { name: "Page 1" })))
    expect(await within(results).findByRole("link", { name: "Welcome" })).toBeInTheDocument()
    const authorsLoaded = new Promise<void>((resolve) => {
      function complete({ request }: { request: Request }) {
        if (new URL(request.url).pathname.endsWith("/authors")) resolve()
      }
      server.events.on("request:end", complete)
      onTestFinished(() => server.events.removeListener("request:end", complete))
    })
    fireEvent.click(screen.getByRole("button", { name: "Author: All authors" }))
    await router.settle(() => authorsLoaded)
    await router.settle(() =>
      fireEvent.click(screen.getByRole("menuitemradio", { name: /^@mona\b/ })),
    )
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("author")).toBe("mona"),
    )
    expect(within(results).queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
    const search = screen.getByRole("searchbox", { name: "Search prototypes" })
    fireEvent.change(search, { target: { value: "navigation" } })
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("prototype")
    await router.settle(() => fireEvent.keyDown(search, { key: "Enter" }))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("q")).toBe("navigation"),
    )
    expect(within(results).getByRole("link", { name: "Navigation" })).toBeInTheDocument()

    await router.go(-1)
    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveValue("prototype"),
    )
    expect(screen.getByRole("button", { name: "Author: @mona" })).toBeInTheDocument()
    await router.go(-1)
    await within(results).findByRole("link", { name: "Welcome" })
    await router.go(-1)

    expect(await within(results).findByRole("link", { name: "Settings" })).toBeInTheDocument()
    expect(within(results).queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked()
    expect(new URLSearchParams(router.state.location.search).get("page")).toBe("2")
    expect(new URLSearchParams(router.state.location.search).get("author")).toBeNull()
  }, 15_000)

  it("opens retained prototype, history and Build pages without hijacking modified links", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001")
    const results = await screen.findByRole("region", { name: "Prototypes" })
    const welcome = within(results).getByRole("link", { name: "Welcome" })
    const nativeClick = vi.fn()
    document.addEventListener(
      "click",
      (event) => {
        nativeClick(event.defaultPrevented)
        event.preventDefault()
      },
      { once: true },
    )

    fireEvent.click(welcome, { ctrlKey: true })
    expect(nativeClick).toHaveBeenCalledExactlyOnceWith(false)
    expect(router.state.location.pathname).toBe("/repositories/2001")
    await router.settle(() => fireEvent.click(welcome))
    expect(await screen.findByTitle("Welcome, Build 3 preview")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    const history = screen.getByRole("menuitem", { name: "History" }).querySelector("a")
    if (!history) throw new Error("The History action has no link.")
    await router.settle(() => fireEvent.click(history))
    expect(await screen.findByRole("heading", { name: "History", level: 2 })).toBeInTheDocument()
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Older Builds" })))
    expect(await screen.findByRole("link", { name: "Build 1" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Build 3" })).not.toBeInTheDocument()
    await router.go(-1)
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Build 2" })))

    expect(await screen.findByRole("heading", { name: "Build 2", level: 2 })).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByText("The synthetic build command exited with code 1.")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/repositories/2001/prototypes/1/builds/2")
  }, 15_000)

  it("retains a failed edit draft and publishes a successful retry consistently", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    let finishSave: (() => void) | undefined
    const saving = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    onTestFinished(() => finishSave?.())
    const patchRequests = vi.fn()
    server.use(
      http.patch(`${window.location.origin}/api/repositories/2001/prototypes/1`, async () => {
        patchRequests()
        await saving
        return HttpResponse.json({ error: "That prototype name is unavailable." }, { status: 422 })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1?build=1")
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const dialog = screen.getByRole("dialog")
    const heading = within(dialog).getByRole("heading", { level: 2 })
    const headingText = heading.textContent?.replace(/\s+/g, " ").trim() ?? ""
    expect(heading).toBeVisible()
    expect(headingText).toMatch(/\S/)
    expect(dialog).toHaveAccessibleName(headingText)
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    const description = within(dialog).getByRole("textbox", { name: "Description" })
    fireEvent.change(name, { target: { value: "Welcome revised" } })
    fireEvent.change(description, { target: { value: "A revised welcome flow." } })
    const form = name.closest("form")
    if (!form) throw new Error("The prototype editor has no form.")

    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(patchRequests).toHaveBeenCalledOnce())
    expect(within(dialog).getByRole("button", { name: "Save details" })).toBeDisabled()
    expect(dialog).toHaveFocus()
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false)
    expect(dialog).toHaveFocus()
    if (!finishSave) throw new Error("The pending save did not expose its completion.")
    finishSave()
    await router.settle()
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That prototype name is unavailable.",
    )
    expect(name).toHaveValue("Welcome revised")
    expect(description).toHaveValue("A revised welcome flow.")
    await waitFor(() => expect(name).toHaveFocus())

    server.resetHandlers()
    await router.settle(() =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Save details" })),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByTitle("Welcome revised, Build 1 preview")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const reopened = screen.getByRole("dialog", { name: "Edit prototype details" })
    expect(within(reopened).getByRole("textbox", { name: "Name" })).toHaveValue("Welcome revised")
    expect(within(reopened).getByRole("textbox", { name: "Description" })).toHaveValue(
      "A revised welcome flow.",
    )
    fireEvent.click(within(reopened).getByRole("button", { name: "Close prototype information" }))
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Prototypes" })))
    const results = await screen.findByRole("region", { name: "Prototypes" })
    expect(within(results).getByRole("link", { name: "Welcome revised" })).toBeInTheDocument()
    expect(within(results).queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
  }, 15_000)

  it("keeps an invalid edit visible with its draft and sends no mutation request", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const patchRequests = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (request.method === "PATCH") patchRequests()
    })
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const dialog = screen.getByRole("dialog", { name: "Edit prototype details" })
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    const description = within(dialog).getByRole("textbox", { name: "Description" })
    fireEvent.change(name, { target: { value: "   " } })
    fireEvent.change(description, { target: { value: "Keep this unsaved description." } })

    await router.settle(() =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Save details" })),
    )

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/\S/)
    expect(name).toHaveValue("   ")
    expect(description).toHaveValue("Keep this unsaved description.")
    expect(patchRequests).not.toHaveBeenCalled()
    expect(store.getPrototype(2001, 1).prototype.name).toBe("Welcome")
  })

  it("keeps the same draft and retry available when saving and matched loaders are unavailable", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const dialog = screen.getByRole("dialog")
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    const description = within(dialog).getByRole("textbox", { name: "Description" })
    fireEvent.change(name, { target: { value: "Keep this name draft" } })
    fireEvent.change(description, { target: { value: "Keep this description draft." } })
    const failedReads = vi.fn(() =>
      HttpResponse.json({ error: "The loaded resources are unavailable." }, { status: 503 }),
    )
    const failedSave = vi.fn(() =>
      HttpResponse.json({ error: "Saving is temporarily unavailable." }, { status: 503 }),
    )
    const prototypeUrl = `${window.location.origin}/api/repositories/2001/prototypes/1`
    server.use(
      http.patch(prototypeUrl, failedSave),
      http.get(prototypeUrl, failedReads),
      http.get(`${window.location.origin}/api/workspace`, failedReads),
      http.get(`${window.location.origin}/api/session`, failedReads),
    )

    await router.settle(() =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Save details" })),
    )
    await screen.findByRole("alert")

    expect(failedSave).toHaveBeenCalledOnce()
    expect(failedReads).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBe(dialog)
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Saving is temporarily unavailable.",
    )
    expect(name).toHaveValue("Keep this name draft")
    expect(description).toHaveValue("Keep this description draft.")
    expect(within(dialog).getByRole("button", { name: "Save details" })).toBeEnabled()
  })

  it("shows a real HTTP failure instead of falling back to the mock repository", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${window.location.origin}/api/repositories/2001`, () =>
        HttpResponse.json({ error: "The repository service is unavailable." }, { status: 503 }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The repository service is unavailable.",
    )
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
  })
})
