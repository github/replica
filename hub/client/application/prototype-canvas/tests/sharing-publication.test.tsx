import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./sharing-fixture"
import { isHubStatusRequest } from "./is-hub-status-request"
import { App } from ".."

describe("App()", () => {
  it("opens internal review for a repository reader without requesting public links or publishing", async () => {
    const { fetch } = sharingFixture(publicationState, {
      ...publicationHub,
      state: "connected",
      prototype: { ...importedPrototype, canEdit: false, canManageShareLinks: false },
    })
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Published" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    const page = await screen.findByRole("main", { name: "Share prototype" })
    expect(
      await within(page).findByRole("textbox", { name: "Internal prototype link" }),
    ).toHaveValue(importedPrototype.build!.url)
    expect(
      within(page).queryByRole("button", { name: "Create share link" }),
    ).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.some(
        ([path]) => path === "/api/publish" || path === "/api/hub/share-links/list",
      ),
    ).toBe(false)
    view.unmount()
  })

  it.each([false, true])(
    "dispatches only explicit Publish, blocks duplicates and waits for Manage share links without navigating (older Hub: %s)",
    async (olderHub) => {
      const { fixture, fetch } = sharingFixture(
        undefined,
        olderHub
          ? {
              ...publicationHub,
              canPublish: undefined,
              repositoryAuthorized: true,
              registrationReason: "remote_branch_missing",
            }
          : publicationHub,
      )
      const view = render(
        <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
      )
      await screen.findByRole("button", { name: "Publish" })
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
      if (olderHub)
        expect(
          within(screen.getByRole("dialog")).getByText(/has not confirmed publishing permission/),
        ).toBeInTheDocument()
      expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
      const publish = within(screen.getByRole("dialog")).getByRole("button", {
        name: "Publish",
      })
      fireEvent.click(publish)
      fireEvent.click(publish)
      await waitFor(() =>
        expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
      )
      await screen.findByRole("dialog", { name: "Preparing your prototype" })
      expect(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Waiting for Copilot" }),
      ).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: "Close sharing readiness" }))
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
      expect(screen.getByRole("dialog", { name: "Preparing your prototype" })).toBeInTheDocument()
      fixture.hub = {
        ...publicationHub,
        state: "connected",
        prototype: { ...importedPrototype, canManageShareLinks: true },
      }
      fireEvent.focus(window)
      const manage = await within(screen.getByRole("dialog")).findByRole("button", {
        name: "Share prototype",
      })
      expect(screen.queryByRole("main", { name: "Share prototype" })).not.toBeInTheDocument()
      expect(fetch.mock.calls.some(([path]) => path.includes("/share-links/"))).toBe(false)
      fireEvent.click(manage)
      await screen.findByRole("main", { name: "Share prototype" })
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
      expect(fetch.mock.calls.some(([path]) => path === "/api/hub/share-links/create")).toBe(false)
      view.unmount()
    },
  )
  it("reports older-Hub publishing failures without claiming publication or sharing readiness", async () => {
    const { fetch } = sharingFixture(undefined, {
      ...publicationHub,
      canPublish: undefined,
      repositoryAuthorized: true,
    })
    const original = fetch.getMockImplementation()!
    fetch.mockImplementation((path) =>
      path === "/api/publish"
        ? Promise.resolve(
            new Response(JSON.stringify({ error: "Repository write access denied." }), {
              status: 403,
            }),
          )
        : original(path),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Publish" })
    fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }))
    await waitFor(() =>
      expect(
        within(screen.getByRole("dialog")).getByText("Repository write access denied."),
      ).toBeInTheDocument(),
    )
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Retry publish" }),
    ).toBeEnabled()
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: "Share prototype" }),
    ).not.toBeInTheDocument()
    expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1)
    expect(fetch.mock.calls.some(([path]) => path.includes("/share-links/"))).toBe(false)
    view.unmount()
  })
  it.each(["requested", "failed"] as const)(
    "opens the older published Build directly for a read-only author while newer publication is %s",
    async (requestState) => {
      const { fetch } = sharingFixture(
        {
          ...publicationState,
          stats: { ...publicationState.stats, workingTree: "changed" },
          publishRequest: {
            state: requestState,
            requestedAt: new Date().toISOString(),
            commitSha: publicationState.stats.commitSha,
            error: requestState === "failed" ? "New publication failed" : null,
          },
        },
        {
          ...publicationHub,
          state: "connected",
          prototype: {
            ...importedPrototype,
            canEdit: false,
            canManageShareLinks: true,
            build: { ...importedPrototype.build!, commitSha: "b".repeat(40) },
            currentBuild: {
              commitSha: publicationState.stats.commitSha!,
              state: requestState === "failed" ? "failed" : "queued",
            },
          },
        },
      )
      const respond = fetch.getMockImplementation()!
      let resolveInitialHub!: (response: Response) => void
      const initialHub = new Promise<Response>((resolve) => {
        resolveInitialHub = resolve
      })
      let initialHubResponse: Promise<Response> | undefined
      fetch.mockImplementation((path, options) => {
        if (path === "/api/hub/open" && !initialHubResponse) {
          initialHubResponse = respond(path, options)
          return initialHub
        }
        return respond(path, options)
      })
      const view = render(
        <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
      )
      // Commit the initial Hub identity before opening a scope-bound share context.
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hub/open", expect.anything()))
      await act(async () => {
        resolveInitialHub(await initialHubResponse!)
        await initialHub
      })
      await waitFor(() => expect(screen.getByRole("button", { name: "Welcome" })).toBeEnabled())
      fireEvent.click(screen.getByRole("button", { name: "Share prototype" }))
      const page = await screen.findByRole("main", { name: "Share prototype" })
      await waitFor(() => expect(within(page).getByText("Build 1")).toBeInTheDocument())
      expect(
        within(page).getByText("This is the last published Build, not the current local preview."),
      ).toBeInTheDocument()
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(
        fetch.mock.calls.some(
          ([path]) => path === "/api/publish" || path === "/api/hub/share-links/create",
        ),
      ).toBe(false)
      view.unmount()
    },
  )
  it("opens sharing without publishing and restores focus while keeping a newer Build out of its target", async () => {
    let buildNumber = 1
    const calls: string[] = []
    const prototype = { ...importedPrototype, canManageShareLinks: true }
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        calls.push(path)
        if (path === "/api/hub/events") throw new Error("No live connection")
        const data = isHubStatusRequest(path)
          ? {
              ...publicationHub,
              state: "connected",
              prototype: { ...prototype, build: { ...prototype.build, number: buildNumber } },
            }
          : path === "/api/hub/share-links/context"
            ? {
                target: "fixture",
                repository: publicationHub.repository,
                branch: publicationHub.branch,
                hubOrigin: publicationHub.hubOrigin,
                prototype,
              }
            : path === "/api/hub/share-links/list"
              ? { shareLinks: [], hasMore: false, nextCursor: null }
              : path === "/api/hub/comments"
                ? { comments: [], hasMore: false, nextCursor: null }
                : publicationState
        return Promise.resolve(new Response(JSON.stringify(data)))
      }),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() => expect(calls).toContain("/api/hub/open"))
    await waitFor(() => expect(screen.getByRole("button", { name: "Welcome" })).toBeEnabled())
    const frame = view.container.querySelector("iframe")
    const previewShell = frame?.closest("main")
    const source = frame?.getAttribute("src")
    const share = screen.getByRole("button", { name: "Share prototype" })
    fireEvent.click(share)
    const page = await screen.findByRole("main", { name: "Share prototype" })
    expect(page.parentElement).toHaveClass("canvas-base")
    expect(screen.queryByRole("dialog", { name: "Share prototype" })).not.toBeInTheDocument()
    expect(previewShell).toHaveAttribute("inert")
    expect(previewShell).toHaveAttribute("aria-hidden", "true")
    expect(previewShell).toHaveClass("canvas-shell--inactive")
    expect(view.container.querySelector("iframe")).toBe(frame)
    await waitFor(() => expect(within(page).getByText("Build 1")).toBeInTheDocument())
    buildNumber = 2
    fireEvent.focus(window)
    await waitFor(() => expect(calls).toContain("/api/hub/activity"))
    expect(within(page).getByText("Build 1")).toBeInTheDocument()
    expect(calls).not.toContain("/api/hub/share-links/create")
    expect(calls).not.toContain("/api/publish")
    fireEvent.click(within(page).getByRole("button", { name: "Back to preview" }))
    expect(screen.queryByRole("main", { name: "Share prototype" })).not.toBeInTheDocument()
    expect(previewShell).not.toHaveAttribute("inert")
    expect(previewShell).not.toHaveAttribute("aria-hidden")
    expect(previewShell).not.toHaveClass("canvas-shell--inactive")
    expect(view.container.querySelector("iframe")).toBe(frame)
    expect(frame).toHaveAttribute("src", source)
    expect(document.activeElement).toBe(share)
    view.unmount()
  })
})
