import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { HubStatus } from "@utils/prototype-canvas/types"
import { publicationHub, publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { isHubStatusRequest } from "./is-hub-status-request"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."

describe("App()", () => {
  it.each([false, true])(
    "preserves the Hub sidebar's open=%s state after approval with different configured Hub",
    async (open) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
      const { fixture, fetch } = sharingFixture(undefined, {
        ...publicationHub,
        state: "disconnected",
      })
      const respond = fetch.getMockImplementation()!
      fetch.mockImplementation((path, options) => {
        if (path === "/api/hub/poll") {
          fixture.hub = {
            ...fixture.hub,
            state: "undiscovered",
            pairing: undefined,
            discovery: {
              state: "valid",
              origin: "https://other.example.com",
              mismatch: true,
            },
          }
          return Promise.resolve(Response.json({ status: "approved" }))
        }
        return respond(path, options)
      })
      const view = render(
        <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
      )
      await screen.findByRole("dialog", { name: "Connect to the Hub" })
      const frame = screen.getByTitle("Demo prototype")
      if (open) {
        fireEvent.click(screen.getByRole("button", { name: "Close connection dialog" }))
        fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
        fireEvent.click(
          within(screen.getByRole("complementary", { name: "Hub" })).getByRole("button", {
            name: "Connect to the Hub",
          }),
        )
      } else {
        fireEvent.click(
          within(screen.getByRole("dialog", { name: "Connect to the Hub" })).getByRole("button", {
            name: "Connect to the Hub",
          }),
        )
      }
      await screen.findByText(/Make sure your browser shows the same code/)
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "Connect to the Hub" }),
        ).not.toBeInTheDocument(),
      )
      expect(screen.getByRole("button", { name: "Edit details" })).toHaveAttribute(
        "aria-expanded",
        String(open),
      )
      expect(Boolean(screen.queryByRole("complementary", { name: "Hub" }))).toBe(open)
      expect(screen.getByTitle("Demo prototype")).toBe(frame)
      view.unmount()
    },
  )

  it("opens browser approval from either entry point, handles browser failure, and reuses the saved connection", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const pairing = {
      verificationUrl: "https://team.example.com/canvas/pair/ABCD",
      userCode: "ABCD",
    }
    let status: HubStatus = {
      state: "disconnected",
      repository: "github/prototype",
      branch: "prototype/first",
      hubOrigin: "https://team.example.com",
      discovery: { state: "absent" },
    }
    let connections = 0
    let approve = false
    const fetch = vi.fn((path: RequestInfo | URL) => {
      let data: object = {
        name: "First",
        stats: {
          ...publicationState.stats,
          repository: "github/prototype",
          branch: status.branch,
          remoteBranch: {
            state: "absent",
            repository: "github/prototype",
            branch: status.branch,
            commitSha: publicationState.stats.commitSha,
          },
        },
      }
      if (isHubStatusRequest(path)) data = status
      if (path === "/api/hub/connect") {
        connections += 1
        status = { ...status, state: "pairing", pairing }
        data = connections <= 2 ? { ...pairing, browserError: "No browser available." } : pairing
      }
      if (path === "/api/hub/poll") {
        data = { status: approve ? "approved" : "pending" }
        if (approve) status = { ...status, state: "undiscovered", pairing: undefined }
      }
      return Promise.resolve(
        new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    const dialog = await screen.findByRole("dialog", { name: "Connect to the Hub" })
    expect(connections).toBe(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect to the Hub" }))
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Could not open your browser"),
    )
    expect(within(dialog).getByRole("link", { name: "Connect to the Hub" })).toHaveAttribute(
      "href",
      pairing.verificationUrl,
    )
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Close connection dialog" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const sidebar = screen.getByRole("complementary", { name: "Hub" })
    fireEvent.click(within(sidebar).getByRole("button", { name: "Connect to the Hub" }))
    await waitFor(() => expect(connections).toBe(2))
    const reopenedDialog = screen.getByRole("dialog", { name: "Connect to the Hub" })
    await waitFor(() =>
      expect(within(reopenedDialog).getByRole("alert")).toHaveTextContent(
        "Could not open your browser",
      ),
    )
    expect(
      within(reopenedDialog).getByRole("link", { name: "Connect to the Hub" }),
    ).toHaveAttribute("href", pairing.verificationUrl)
    expect(within(sidebar).queryByRole("textbox")).not.toBeInTheDocument()
    expect(
      within(sidebar).queryByRole("link", { name: "Connect to the Hub" }),
    ).not.toBeInTheDocument()
    expect(within(sidebar).queryByText(/One approval/)).not.toBeInTheDocument()
    fireEvent.click(within(reopenedDialog).getByRole("button", { name: "Close connection dialog" }))
    expect(within(sidebar).getByRole("button", { name: "Connect to the Hub" })).toHaveFocus()
    expect(screen.queryByRole("dialog", { name: "Connect to the Hub" })).not.toBeInTheDocument()
    fireEvent.click(within(sidebar).getByRole("button", { name: "Connect to the Hub" }))
    await waitFor(() => expect(connections).toBe(3))
    expect(screen.getAllByRole("dialog", { name: "Connect to the Hub" })).toHaveLength(1)
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog", { name: "Connect to the Hub" })).queryByRole("alert"),
      ).not.toBeInTheDocument(),
    )
    approve = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Connect to the Hub" })).not.toBeInTheDocument(),
    )
    expect(
      screen.getByText("This branch won't appear in the hub until you publish."),
    ).toBeInTheDocument()
    view.unmount()

    status = { ...status, branch: "prototype/second" }
    const second = render(
      <App config={{ name: "Second", prototypeUrl: "http://localhost:4322/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Second" })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.queryByRole("dialog", { name: "Connect to the Hub" })).not.toBeInTheDocument()
    expect(connections).toBe(3)
    second.unmount()
  })
  it("reopens URL selection after approving and disconnecting in the same session", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const pairing = {
      verificationUrl: "https://team.example.com/canvas/pair/ABCD",
      userCode: "ABCD",
    }
    let status: HubStatus = {
      state: "disconnected",
      repository: "github/prototype",
      branch: "prototype/first",
      hubOrigin: "https://team.example.com",
    }
    let connections = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((path: RequestInfo | URL, init?: RequestInit) => {
        let data: object = {
          ...publicationState,
          stats: {
            ...publicationState.stats,
            repository: status.repository,
            branch: status.branch,
          },
        }
        if (path === "/api/hub/connect") {
          connections += 1
          status = { ...status, state: "pairing", pairing }
          data = pairing
        }
        if (path === "/api/hub/poll") {
          status = { ...status, state: "undiscovered", pairing: undefined }
          data = { status: "approved" }
        }
        if (path === "/api/hub/disconnect") {
          status = { ...status, state: "disconnected" }
        }
        if (path === "/api/hub/origin") {
          expect(init?.body).toBe(JSON.stringify({ origin: "https://new.example.com" }))
          status = { ...status, hubOrigin: "https://new.example.com" }
        }
        if (isHubStatusRequest(path)) data = status
        return Promise.resolve(Response.json(data))
      }),
    )
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    const initial = await screen.findByRole("dialog", { name: "Connect to the Hub" })
    fireEvent.click(within(initial).getByRole("button", { name: "Connect to the Hub" }))
    await screen.findByText(/Make sure your browser shows the same code/)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Connect to the Hub" })).not.toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect Hub" }))
    const reopened = await screen.findByRole("dialog", { name: "Connect to the Hub" })
    expect(connections).toBe(1)
    expect(within(reopened).getByRole("link", { name: "https://team.example.com" })).toBeVisible()
    fireEvent.click(within(reopened).getByRole("button", { name: "Edit Hub URL" }))
    const input = within(reopened).getByRole("textbox", { name: "Hub URL" })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: "https://new.example.com" } })
    fireEvent.click(within(reopened).getByRole("button", { name: "Save Hub" }))
    await within(reopened).findByRole("link", { name: "https://new.example.com" })
    expect(connections).toBe(1)
    // The saved URL can render before the dialog's focus effect runs.
    await waitFor(() =>
      expect(within(reopened).getByRole("button", { name: "Edit Hub URL" })).toHaveFocus(),
    )
    view.unmount()
  })
})
