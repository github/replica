import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  importedPrototype,
  publicationExamples,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./sharing-fixture"
import { isHubStatusRequest } from "./is-hub-status-request"

import { App } from ".."

describe("App()", () => {
  it("explains unpublished sharing without API side effects, restores focus and keeps the iframe visible", async () => {
    const { fetch } = sharingFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled()
    await waitFor(() =>
      expect(fetch.mock.calls.some(([path]) => path === "/api/hub/open")).toBe(true),
    )
    const frame = screen.getByTitle("Demo prototype")
    const share = screen.getByRole("button", { name: "Share prototype" })
    fetch.mockClear()
    fireEvent.click(share)
    const dialog = screen.getByRole("dialog", { name: "Publish before sharing" })
    expect(within(dialog).getByText(/Your local preview stays private/)).toBeInTheDocument()
    expect(frame.closest("main")).not.toHaveAttribute("inert")
    expect(screen.queryByRole("main", { name: "Share prototype" })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(document.activeElement).toBe(share)
    fireEvent.click(share)
    fireEvent.click(screen.getByRole("button", { name: "Close sharing readiness" }))
    expect(document.activeElement).toBe(share)
    fireEvent.click(share)
    fireEvent.click(screen.getByRole("dialog"), { clientX: -1, clientY: -1 })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(document.activeElement).toBe(share)
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    view.unmount()
  })
  it("offers Connect for the server's unconfigured status without branch metadata", async () => {
    const { fetch } = sharingFixture(undefined, {
      state: "unconfigured",
      repository: publicationState.stats.repository,
      message: "Enter a Hub URL to connect.",
    })
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("dialog", { name: "Connect to the Hub" })
    fireEvent.click(screen.getByRole("button", { name: "Close connection dialog" }))
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    expect(
      within(screen.getByRole("dialog", { name: "Connect before sharing" })).getByRole("button", {
        name: "Connect to Hub",
      }),
    ).toBeInTheDocument()
    expect(
      fetch.mock.calls.some(([path]) => path === "/api/hub/connect" || path === "/api/publish"),
    ).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Connect to Hub" }))
    expect(screen.getByRole("dialog", { name: "Connect to the Hub" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Connect before sharing" })).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.some(([path]) => path === "/api/hub/connect" || path === "/api/publish"),
    ).toBe(false)
    view.unmount()
  })
  it("shows the actual initial Hub status failure instead of a changed-target explanation", async () => {
    const { fixture, fetch } = sharingFixture()
    fixture.hubError = "Initial Hub verification failed."
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Retry status" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    const dialog = screen.getByRole("dialog", { name: "Sharing status unavailable" })
    expect(
      within(dialog).getByText("Hub status unavailable: Initial Hub verification failed."),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Retry status" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    view.unmount()
  })
  it("rechecks Hub and branch status together from the sidebar's single retry", async () => {
    const { fixture, fetch } = sharingFixture()
    fixture.hubError = "Load failed"
    fixture.state.stats.remoteBranch = {
      ...fixture.state.stats.remoteBranch!,
      state: "unknown",
      error: "Load failed",
    }
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Retry status" })
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const panel = screen.getByRole("complementary", { name: "Hub" })
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Hub status unavailable: Load failed",
    )
    expect(within(panel).queryByText(/Remote branch status is unknown/)).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole("button", { name: "Retry connection" }),
    ).not.toBeInTheDocument()
    fixture.hubError = ""
    fetch.mockClear()
    fireEvent.click(within(panel).getByRole("button", { name: "Retry status" }))
    await waitFor(() => {
      expect(fetch.mock.calls.some(([path]) => path === "/api/refresh")).toBe(true)
      expect(fetch.mock.calls.some(([path]) => path === "/api/hub/status")).toBe(true)
      expect(
        within(panel).getByText("Remote branch status is unknown. Load failed"),
      ).toBeInTheDocument()
    })
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    view.unmount()
  })
  it("hands off to the existing connection approval dialog and returns to the next explicit action", async () => {
    const { fixture, fetch } = sharingFixture(undefined, {
      ...publicationHub,
      state: "disconnected",
    })
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("dialog", { name: "Connect to the Hub" })
    fireEvent.click(screen.getByRole("button", { name: "Close connection dialog" }))
    const share = screen.getByRole("button", { name: "Share prototype" })
    fireEvent.click(share)
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(fetch.mock.calls.some(([path]) => path === "/api/hub/connect")).toBe(false)
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Connect to Hub" }),
    )
    await screen.findByText("ABCD")
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(fetch.mock.calls.filter(([path]) => path === "/api/hub/connect")).toHaveLength(1)
    fixture.hub = { ...publicationHub }
    fireEvent.focus(window)
    await screen.findByRole("dialog", { name: "Publish before sharing" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Close sharing readiness" }))
    expect(document.activeElement).toBe(share)
    view.unmount()
  })
  it("retries unknown status without publishing and shows accurate import progress", async () => {
    const { fixture, fetch } = sharingFixture(undefined, {
      ...publicationHub,
      state: "unavailable",
      message: "Hub verification timed out",
    })
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Retry status" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    expect(
      within(screen.getByRole("dialog")).getByText("Hub verification timed out"),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: /Publish/ }),
    ).not.toBeInTheDocument()
    fixture.hub = publicationExamples["Awaiting Hub import"]!.hub!
    fixture.state = publicationExamples["Awaiting Hub import"]!.state!
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Retry status" }),
    )
    await screen.findByRole("dialog", { name: "Preparing your prototype" })
    expect(
      within(screen.getByRole("dialog")).getByText(/workflow succeeded. Waiting for Hub discovery/),
    ).toBeInTheDocument()
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    view.unmount()
  })
  it("shows Retry for a lost Hub response without mistaking missing metadata for a target change", async () => {
    const { fixture } = sharingFixture()
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Publish" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    fixture.hubError = "Hub temporarily unavailable"
    fireEvent.focus(window)
    await screen.findByRole("dialog", { name: "Sharing status unavailable" })
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Retry status" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Sharing target changed" })).not.toBeInTheDocument()
    fixture.hubError = ""
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Retry status" }),
    )
    await screen.findByRole("dialog", { name: "Publish before sharing" })
    view.unmount()
  })
  it("keeps an initial checking dialog open for explicit Manage instead of navigating when status arrives", async () => {
    const { fetch } = sharingFixture(undefined, {
      ...publicationHub,
      state: "connected",
      prototype: { ...importedPrototype, canManageShareLinks: true },
    })
    const original = fetch.getMockImplementation()!
    let resolveHub!: (response: Response) => void
    const pendingHub = new Promise<Response>((resolve) => {
      resolveHub = resolve
    })
    fetch.mockImplementation((path) => (isHubStatusRequest(path) ? pendingHub : original(path)))
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    expect(screen.getByRole("dialog", { name: "Checking sharing readiness" })).toBeInTheDocument()
    await act(async () => {
      resolveHub(
        new Response(
          JSON.stringify({
            ...publicationHub,
            state: "connected",
            prototype: { ...importedPrototype, canManageShareLinks: true },
          }),
        ),
      )
      await pendingHub
    })
    await within(screen.getByRole("dialog")).findByRole("button", { name: "Share prototype" })
    expect(fetch.mock.calls.some(([path]) => path.includes("/share-links/"))).toBe(false)
    expect(screen.queryByRole("main", { name: "Share prototype" })).not.toBeInTheDocument()
    view.unmount()
  })
  it("does not cancel an in-flight publish on close and reopens against its resulting state", async () => {
    const { fetch } = sharingFixture()
    const original = fetch.getMockImplementation()!
    let finishPublish!: () => Promise<void>
    fetch.mockImplementation((path) =>
      path === "/api/publish"
        ? new Promise<Response>((resolve) => {
            finishPublish = () => original(path).then(resolve)
          })
        : original(path),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Publish" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }))
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
    )
    fireEvent.click(screen.getByRole("button", { name: "Close sharing readiness" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await act(async () => {
      await finishPublish()
    })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    await screen.findByRole("dialog", { name: "Preparing your prototype" })
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
    view.unmount()
  })
  it.each(["branch", "repository", "Hub"] as const)(
    "requires reopening after a %s change without repurposing the dialog",
    async (change) => {
      const { fixture, fetch } = sharingFixture()
      const view = render(
        <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
      )
      await screen.findByRole("button", { name: "Publish" })
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
      if (change === "Hub")
        fixture.hub = { ...fixture.hub, hubOrigin: "https://another-hub.example.com" }
      else {
        fixture.state = {
          ...fixture.state,
          stats: {
            ...fixture.state.stats,
            [change]: "another",
            remoteBranch: { ...fixture.state.stats.remoteBranch!, [change]: "another" },
          },
        }
        fixture.hub = { ...fixture.hub, [change]: "another" }
      }
      fireEvent.focus(window)
      await screen.findByRole("dialog", { name: "Sharing target changed" })
      expect(
        within(screen.getByRole("dialog")).queryByRole("button", { name: /Publish|Manage/ }),
      ).not.toBeInTheDocument()
      expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
      fireEvent.click(screen.getByRole("button", { name: "Close sharing readiness" }))
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
      expect(
        screen.queryByRole("dialog", { name: "Sharing target changed" }),
      ).not.toBeInTheDocument()
      view.unmount()
    },
  )
})
