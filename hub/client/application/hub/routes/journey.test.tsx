import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { authenticatedWorkspace } from "./fixtures/authenticated-workspace"
import { previewHandlers } from "./fixtures/preview-handlers"
import { previewRecords } from "./fixtures/preview-records"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function editorApi(data = previewRecords()) {
  return stubHubFetch(
    ...authenticatedWorkspace([data.repository]),
    ...previewHandlers(data),
    http.get(`/api${data.path}/review-comments`, () =>
      Response.json({ comments: [], nextCursor: null, hasMore: false }),
    ),
    http.get(`/api${data.galleryPath}`, () =>
      Response.json({
        repository: data.repository,
        prototypes: [data.prototype],
        authors: [],
        pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 1 },
      }),
    ),
  )
}

describe("Hub repository journey", () => {
  it("restores applied search, author, page and view state through back navigation", async () => {
    const { repository, prototype, galleryPath } = previewRecords()
    const author = {
      id: "33333333-3333-4333-8333-333333333333",
      login: "mona",
      name: "Mona",
      avatarUrl: null,
    }
    const searchReads: string[] = []
    const api = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      http.get(`/api${galleryPath}/authors`, () =>
        Response.json({ authors: [author], nextCursor: null }),
      ),
      http.get(`/api${galleryPath}`, ({ request }) => {
        const { search, searchParams } = new URL(request.url)
        searchReads.push(search)
        const page = Number(searchParams.get("page") ?? "1")
        const name = page === 2 ? "Settings" : searchParams.has("author") ? "Navigation" : "Welcome"
        const selection =
          name === "Welcome"
            ? prototype
            : { ...prototype, id: name === "Settings" ? "3" : "2", name, builds: [] }
        return Response.json({
          repository,
          prototypes: [selection],
          authors: [author],
          pagination: { page, pageSize: 24, pageCount: 2, totalCount: 25 },
        })
      }),
    )
    const router = await renderHubFlow(api, "/repositories/2001?q=journey&page=2&view=list")
    const results = await screen.findByRole("region", { name: "Prototypes" })
    expect(within(results).getByRole("link", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveValue("journey")
    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked()

    await router.settle(() => fireEvent.click(screen.getByRole("button", { name: "Page 1" })))
    expect(await within(results).findByRole("link", { name: "Welcome" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "User: All users" }))
    const authorOption = await screen.findByRole(
      "menuitemradio",
      { name: /@mona\b/ },
      { timeout: 5000 },
    )
    await router.settle(() => fireEvent.click(authorOption))
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("author")).toBe(author.id),
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
    expect(screen.getByRole("button", { name: "User: @mona" })).toBeInTheDocument()
    await router.go(-1)
    await within(results).findByRole("link", { name: "Welcome" })
    await router.go(-1)

    expect(await within(results).findByRole("link", { name: "Settings" })).toBeInTheDocument()
    expect(within(results).queryByRole("link", { name: "Welcome" })).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked()
    expect(new URLSearchParams(router.state.location.search).get("page")).toBe("2")
    expect(new URLSearchParams(router.state.location.search).get("author")).toBeNull()
    expect(searchReads).toEqual([
      "?q=journey&page=2",
      "?q=journey",
      `?q=journey&author=${author.id}`,
      `?q=navigation&author=${author.id}`,
      `?q=journey&author=${author.id}`,
      "?q=journey",
      "?q=journey&page=2",
    ])
  }, 15_000)

  it("shows commit authors in Build history", async () => {
    const data = previewRecords()
    const { repository, prototype, historical, path } = data
    const authors = [
      {
        provider: "entra",
        login: "sam@example.test",
        name: "Sam Rivera",
      },
      {
        provider: "entra",
        login: "lee@example.test",
        name: null,
      },
      {
        provider: "github",
        login: "mona",
        name: "Mona Lisa",
      },
      { provider: null, login: null, name: null },
      { provider: null, login: "legacy-author", name: null },
    ]
    const builds = authors.map((author, index) => ({
      ...historical,
      number: index + 1,
      commitAuthorProvider: author.provider,
      commitAuthorLogin: author.login,
      commitAuthorName: author.name,
    }))
    const server = stubHubFetch(
      ...authenticatedWorkspace([repository]),
      http.get(`/api${path}/builds`, () =>
        Response.json({
          repository,
          prototype: { ...prototype, builds },
          builds,
          pagination: { page: 1, pageCount: 1, pageSize: 25, totalCount: builds.length },
        }),
      ),
    )
    await renderHubFlow(server, "/repositories/2001/prototypes/1/builds")

    expect(screen.getByText("By Sam Rivera").closest("a")).toBeNull()
    expect(screen.getByText("By lee@example.test").closest("a")).toBeNull()
    expect(screen.getByText("By @mona").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/mona",
    )
    expect(screen.getByText("Unknown author").closest("a")).toBeNull()
    expect(screen.getByText("By legacy-author").closest("a")).toBeNull()
  }, 15_000)

  it("retains a failed edit draft and publishes a successful retry consistently", async () => {
    const data = previewRecords()
    const server = editorApi(data)
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
        return Response.json({ error: "That prototype name is unavailable." }, { status: 422 })
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

    server.use(
      http.patch(`/api${data.path}`, async ({ request }) => {
        const updates = (await request.json()) as { name: string; description: string }
        Object.assign(data.prototype, updates)
        return Response.json({
          repository: data.repository,
          prototype: data.prototype,
          selectedBuild: data.historical,
        })
      }),
    )
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
    const data = previewRecords()
    const server = editorApi(data)
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
    expect(server.requests.some(({ method }) => method === "PATCH")).toBe(false)
  })

  it("keeps the same draft and retry available when saving and matched loaders are unavailable", async () => {
    const data = previewRecords()
    const server = editorApi(data)
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/1")
    fireEvent.click(screen.getByRole("button", { name: "View prototype" }))
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const dialog = screen.getByRole("dialog")
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    const description = within(dialog).getByRole("textbox", { name: "Description" })
    fireEvent.change(name, { target: { value: "Keep this name draft" } })
    fireEvent.change(description, { target: { value: "Keep this description draft." } })
    const failedReads = vi.fn(() =>
      Response.json({ error: "The loaded resources are unavailable." }, { status: 503 }),
    )
    const failedSave = vi.fn(() =>
      Response.json({ error: "Saving is temporarily unavailable." }, { status: 503 }),
    )
    const prototypeUrl = `${window.location.origin}/api/repositories/2001/prototypes/1`
    server.use(
      http.patch(prototypeUrl, failedSave),
      http.get(prototypeUrl, failedReads),
      http.get(`${window.location.origin}/api/workspace`, failedReads),
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
})
