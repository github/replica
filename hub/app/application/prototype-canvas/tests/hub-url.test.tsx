import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { HubStatus } from "@utils/prototype-canvas/types"
import { publicationHub, publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { isHubStatusRequest } from "./is-hub-status-request"
import { App } from ".."

describe("App()", () => {
  it("saves and normalizes an unknown Hub before starting approval and allows retries", async () => {
    let status: HubStatus = {
      state: "unconfigured",
      repository: "github/prototype",
      branch: "prototype/first",
    }
    let attempts = 0
    const paths: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: RequestInit) => {
        paths.push(path)
        let data: object = {
          name: "First",
          stats: { repository: "github/prototype", branch: "prototype/first" },
        }
        if (path === "/api/hub/origin") {
          expect(init?.body).toBe(
            JSON.stringify({ origin: "https://team.example.com/repositories/1" }),
          )
          status = { ...status, state: "disconnected", hubOrigin: "https://team.example.com" }
        }
        if (isHubStatusRequest(path)) data = status
        if (path === "/api/hub/connect") {
          attempts += 1
          if (attempts === 1)
            return Promise.resolve(
              new Response(JSON.stringify({ error: "Hub unavailable." }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }),
            )
          const pairing = {
            verificationUrl: "https://team.example.com/canvas/pair/ABCD",
            userCode: "ABCD",
          }
          status = { ...status, state: "pairing", pairing }
          data = pairing
        }
        return Promise.resolve(
          new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }),
        )
      }),
    )
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("dialog", { name: "Connect to the Hub" })
    fireEvent.click(screen.getByRole("button", { name: "Close connection dialog" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const sidebar = screen.getByRole("complementary", { name: "Hub" })
    expect(within(sidebar).queryByRole("textbox")).not.toBeInTheDocument()
    fireEvent.click(within(sidebar).getByRole("button", { name: "Connect to the Hub" }))
    const dialog = await screen.findByRole("dialog", { name: "Connect to the Hub" })
    expect(paths).not.toContain("/api/hub/connect")
    expect(within(dialog).getByRole("textbox", { name: "Hub URL" })).toHaveFocus()
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Hub URL" }), {
      target: { value: "https://team.example.com/repositories/1" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect to the Hub" }))
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Hub unavailable."),
    )
    expect(paths.indexOf("/api/hub/origin")).toBeLessThan(paths.indexOf("/api/hub/connect"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect to the Hub" }))
    await within(dialog).findByRole("link", { name: "Connect to the Hub" })
    expect(attempts).toBe(2)
    view.unmount()
  })
  it("preserves the attempted URL during a delayed failed Hub save", async () => {
    let finishSave!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/hub/origin")
          return new Promise<Response>((resolve) => {
            finishSave = resolve
          })
        if (isHubStatusRequest(path))
          return Promise.resolve(Response.json({ ...publicationHub, state: "disconnected" }))
        return Promise.resolve(Response.json(publicationState))
      }),
    )
    const view = render(
      <App config={{ name: "Example", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("dialog", { name: "Connect to the Hub" })
    fireEvent.click(screen.getByRole("button", { name: "Edit Hub URL" }))
    const input = await screen.findByRole("textbox", { name: "Hub URL" })
    await waitFor(() => expect(input).toHaveValue("https://hub.example.com"))
    fireEvent.change(input, { target: { value: "http://remote.example.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20))
    })
    expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue(
      "http://remote.example.com",
    )
    act(() => {
      finishSave(Response.json({ error: "Remote Hubs require HTTPS." }, { status: 400 }))
    })
    expect(await screen.findByRole("alert")).toHaveTextContent("Remote Hubs require HTTPS.")
    expect(screen.getByRole("textbox", { name: "Hub URL" })).toHaveValue(
      "http://remote.example.com",
    )
    expect(screen.getByRole("button", { name: "Save Hub" })).toBeEnabled()
    expect(screen.queryByRole("link", { name: "https://hub.example.com" })).not.toBeInTheDocument()
    view.unmount()
  })
  it("hides the old Hub during a switch and ignores stale status", async () => {
    function json(data: object) {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    const oldStatus = {
      state: "connected",
      hubOrigin: "https://old.example.com",
      repository: "github/prototype",
      branch: "prototype/first",
      prototype: {
        id: 1,
        repositoryId: 2001,
        branch: "prototype/first",
        name: "First",
        description: null,
        viewerLogin: "octocat",
        registered: true,
        canEdit: true,
        canRegister: true,
        published: false,
        build: null,
        buildState: null,
        versionCount: 0,
      },
    }
    let statusReads = 0
    let selectedOrigin = "https://old.example.com"
    let finishOldStatus!: (response: Response) => void
    let finishSave!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/hub/events") throw new Error("Live connection unavailable")
        if (isHubStatusRequest(path)) {
          statusReads += 1
          if (statusReads === 2)
            return new Promise<Response>((resolve) => {
              finishOldStatus = resolve
            })
          return Promise.resolve(
            json(
              statusReads === 1
                ? oldStatus
                : {
                    state: "disconnected",
                    hubOrigin: selectedOrigin,
                    repository: "github/prototype",
                    branch: "prototype/first",
                  },
            ),
          )
        }
        if (path === "/api/hub/origin")
          return new Promise<Response>((resolve) => {
            finishSave = resolve
          }).then((response) => {
            selectedOrigin = "https://new.example.com"
            return response
          })
        if (path === "/api/hub/comments")
          return Promise.resolve(json({ comments: [], hasMore: false, nextCursor: null }))
        return Promise.resolve(
          json({
            name: "First",
            stats: { repository: "github/prototype", branch: "prototype/first" },
            publishStatus: { state: "unavailable" },
          }),
        )
      }),
    )

    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() => expect(statusReads).toBe(1))
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    await waitFor(() => expect(screen.getByRole("heading", { name: "Latest Build" })).toBeVisible())
    await waitFor(() => expect(statusReads).toBe(2))
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Hub" }))
    await screen.findByRole("dialog", { name: "Connect to the Hub" })
    fireEvent.click(screen.getByRole("button", { name: "Edit Hub URL" }))
    await screen.findByRole("textbox", { name: "Hub URL" })
    fireEvent.change(screen.getByRole("textbox", { name: "Hub URL" }), {
      target: { value: "https://new.example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save Hub" }))
    expect(screen.queryByRole("heading", { name: "Latest Build" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save metadata" })).not.toBeInTheDocument()

    await act(async () => {
      finishSave(json({ hubOrigin: "https://new.example.com" }))
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "https://new.example.com" })).toBeInTheDocument(),
    )
    act(() => finishOldStatus(json(oldStatus)))
    expect(screen.getByRole("link", { name: "https://new.example.com" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Latest Build" })).not.toBeInTheDocument()
    view.unmount()
  })
})
