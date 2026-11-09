import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createFixtureSeed } from "../mocks/create-fixture-seed"
import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import seedData from "../mocks/seed.json"
import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("Hub repository journey", () => {
  it("restores applied search, author, page and view state through back navigation", async () => {
    const seed = structuredClone(seedData)
    const welcome = seed.prototypes.find(({ id }) => id === "1")
    const navigation = seed.prototypes.find(({ id }) => id === "2")
    const settings = seed.prototypes.find(({ id }) => id === "3")
    if (!welcome || !navigation || !settings)
      throw new Error("The local journey needs three prototypes.")
    seed.prototypes = [
      { ...welcome, description: "A journey prototype." },
      { ...navigation, description: "A journey prototype." },
      ...Array.from({ length: 22 }, (_, index) => ({
        ...welcome,
        id: String(index + 4),
        name: `Journey option ${index + 1}`,
        branchName: `prototype/journey-${index + 1}`,
        authorLogin: index % 2 ? "octocat" : "mona",
        description: "A journey prototype.",
      })),
      { ...settings, description: "A journey prototype." },
    ]
    const store = createMockStore({ origin: window.location.origin, seed })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001?q=journey&page=2&view=list")
    const results = await screen.findByRole("region", { name: "Prototypes" })
    expect(within(results).getByRole("link", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveValue("journey")
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
    expect(new URLSearchParams(router.state.location.search).get("q")).toBe("journey")
    await router.settle(() => fireEvent.keyDown(search, { key: "Enter" }))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("q")).toBe("navigation"),
    )
    expect(within(results).getByRole("link", { name: "Navigation" })).toBeInTheDocument()

    await router.go(-1)
    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveValue("journey"),
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

  it("opens UUID prototype, history and Build pages without hijacking modified links", async () => {
    const repositoryId = "78d6a1e9-9588-45ab-8c46-b5933ca950b3"
    const prototypeId = "0f8fad5b-d9cb-469f-a165-70867728950e"
    const seed = createFixtureSeed()
    seed.repositories[0]!.id = repositoryId
    for (const prototype of seed.prototypes) {
      if (prototype.repositoryId === "2001") prototype.repositoryId = repositoryId
      if (prototype.id === "1") prototype.id = prototypeId
    }
    for (const build of seed.builds) {
      if (build.repositoryId === "2001") build.repositoryId = repositoryId
      if (build.prototypeId === "1") build.prototypeId = prototypeId
    }
    const store = createMockStore({ origin: window.location.origin, seed })
    const latestBuild = store.getPrototype(repositoryId, prototypeId).selectedBuild?.number
    const historyPageCount = store.getBuildHistory(repositoryId, prototypeId).pagination.pageCount
    const failedBuild = store.getBuild(repositoryId, prototypeId, 2).build
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, `/repositories/${repositoryId}`)
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
    expect(router.state.location.pathname).toBe(`/repositories/${repositoryId}`)
    await router.settle(() => fireEvent.click(welcome))
    expect(await screen.findByTitle(`Welcome, Build ${latestBuild} preview`)).toBeInTheDocument()
    expect(
      screen.getByRole<HTMLInputElement>("textbox", { name: "Preview URL" }).value,
    ).not.toMatch(/mock|synthetic|simulat(?:ed|ion)/i)
    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    const history = screen.getByRole("menuitem", { name: "History" }).querySelector("a")
    if (!history) throw new Error("The History action has no link.")
    await router.settle(() => fireEvent.click(history))
    expect(await screen.findByRole("heading", { name: "History", level: 2 })).toBeInTheDocument()
    for (let page = 2; page <= historyPageCount; page += 1) {
      await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Older Builds" })))
      expect(new URLSearchParams(router.state.location.search).get("page")).toBe(String(page))
    }
    expect(await screen.findByRole("link", { name: "Build 1" })).toBeInTheDocument()
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Build 2" })))

    expect(await screen.findByRole("heading", { name: "Build 2", level: 2 })).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
    if (!failedBuild.failureSummary) throw new Error("The failed Build needs an explanation.")
    expect(screen.getByText(failedBuild.failureSummary)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(
      `/repositories/${repositoryId}/prototypes/${prototypeId}/builds/2`,
    )
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
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
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
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
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
    expect(store.getPrototype("2001", "1").prototype.name).toBe("Welcome")
  })

  it("keeps the same draft and retry available when saving and matched loaders are unavailable", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
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
    await renderHubFlow(server, "/repositories/2001", { withTools: true })

    expect(within(await screen.findByRole("main")).getByRole("alert")).toHaveTextContent(
      "The repository service is unavailable.",
    )
    expect(
      screen.getByRole("complementary", { name: "Frontend test controls" }),
    ).not.toHaveTextContent("The repository service is unavailable.")
    expect(screen.queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
  })
})
