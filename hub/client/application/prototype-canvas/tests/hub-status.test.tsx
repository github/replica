import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { isHubStatusRequest } from "./is-hub-status-request"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."

describe("App()", () => {
  it("opens Hub from Comments even when App updates before the transition finishes", async () => {
    vi.useFakeTimers()
    sharingFixture(publicationState, {
      ...publicationHub,
      state: "connected",
      prototype: importedPrototype,
    })
    const config = { name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }
    const view = render(<App config={config} />)
    // Finish the initial Hub identity reset before opening Comments.
    await act(() => vi.advanceTimersByTimeAsync(0))
    await act(() => vi.advanceTimersByTimeAsync(0))
    const frame = screen.getByTitle("Demo prototype")
    const commentsButton = screen.getByRole("button", { name: /^Comments, 0/ })
    fireEvent.click(commentsButton)
    expect(commentsButton).toHaveAttribute("aria-expanded", "true")

    const hubButton = screen.getByRole("button", { name: "Edit details" })
    fireEvent.click(hubButton)
    view.rerender(<App config={{ ...config }} />)
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(commentsButton).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("complementary", { name: "Hub" })).toBeVisible()
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(hubButton).toHaveFocus()
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    view.unmount()
  })

  it("preserves the authoritative activity warning without a second status read", async () => {
    const warning = "Connection activity could not be verified: Offline"
    const fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input === "/api/hub/activity"
              ? { ...publicationHub, message: warning }
              : isHubStatusRequest(input)
                ? publicationHub
                : publicationState,
          ),
        ),
      ),
    )
    vi.stubGlobal("fetch", fetch)
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hub/open", expect.anything()))
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    await screen.findByText(warning)
    expect(fetch.mock.calls.filter(([path]) => path === "/api/hub/status")).toHaveLength(0)
    view.unmount()
  })
  it("offers configured approval on open and records focus, but not polling, as activity", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const data = isHubStatusRequest(input)
        ? {
            state: "disconnected",
            repository: "github/prototype",
            branch: "prototype/uncommitted",
            hubOrigin: "https://team.example.com",
            discovery: {
              state: "valid",
              origin: "https://team.example.com",
              defaultBranch: "trunk",
            },
          }
        : {
            name: "First",
            stats: { repository: "github/prototype", branch: "prototype/uncommitted" },
          }
      return Promise.resolve(
        new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Connect to the Hub" })).toBeInTheDocument(),
    )
    expect(screen.queryByRole("textbox", { name: "Hub URL" })).not.toBeInTheDocument()
    function count(path: string) {
      return fetch.mock.calls.filter(([input]) => input === path).length
    }
    expect(count("/api/hub/activity")).toBe(0)
    expect(count("/api/hub/open")).toBe(1)
    expect(count("/api/hub/pair")).toBe(0)
    expect(count("/api/hub/connect")).toBe(0)
    fireEvent.click(screen.getByRole("button", { name: "Close connection dialog" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000)
    })
    expect(count("/api/hub/activity")).toBe(0)
    expect(count("/api/hub/pair")).toBe(0)
    expect(count("/api/hub/connect")).toBe(0)
    fireEvent.focus(window)
    await waitFor(() => expect(count("/api/hub/activity")).toBe(1))
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Connect to the Hub" })).not.toBeInTheDocument()
    view.unmount()
    const reopened = render(
      <App config={{ name: "Second", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("dialog", { name: "Connect to the Hub" })
    expect(count("/api/hub/pair")).toBe(0)
    reopened.unmount()
  })
})
