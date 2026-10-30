import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { isHubStatusRequest } from "./is-hub-status-request"
import { App } from ".."

describe("App()", () => {
  it("shows the current checkout without claiming the previous branch's comparison", async () => {
    const oldState = {
      name: "First",
      sessionId: "session-123",
      stats: {
        repository: "github/prototype",
        branch: "prototype/first",
        branchError: "Previous branch could not be read.",
        commitSha: "old-commit",
        comparison: { branch: "origin/main", source: "upstream", behind: 3, error: null },
      },
    }
    const nextState = {
      ...oldState,
      stats: {
        ...oldState.stats,
        branch: "prototype/next",
        branchError: null,
        commitSha: "new-commit",
        comparison: { branch: "main", source: "local", behind: 1, error: null },
      },
    }
    function json(data: object) {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    let currentBranch = "prototype/first"
    let refreshes = 0
    let finishRefresh: ((response: Response) => void) | undefined
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (isHubStatusRequest(path))
        return Promise.resolve(
          json({
            state: "disconnected",
            repository: "github/prototype",
            branch: currentBranch,
          }),
        )
      if (path === "/api/refresh") {
        refreshes += 1
        if (refreshes === 1) return Promise.resolve(json(oldState))
        return new Promise<Response>((resolve) => {
          finishRefresh = resolve
        })
      }
      return Promise.resolve(json(oldState))
    })
    vi.stubGlobal("fetch", fetch)
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })

    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "prototype/first" })).toBeEnabled(),
    )
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => isHubStatusRequest(path))).toHaveLength(1),
    )

    currentBranch = "prototype/next"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    await waitFor(() => expect(refreshes).toBe(2))
    fireEvent.click(screen.getByRole("button", { name: "prototype/next" }))
    const dialog = screen.getByRole("dialog", { name: "Build details" })
    expect(within(dialog).getByText("prototype/next")).toBeInTheDocument()
    expect(
      within(dialog).getByText("Branch comparison unavailable until Git stats refresh."),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText("3 commits behind")).not.toBeInTheDocument()
    expect(refreshes).toBe(2)

    act(() =>
      finishRefresh?.(
        new Response(JSON.stringify({ error: "Cannot read Git stats." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText("Cannot read Git stats.")).toBeInTheDocument())
    expect(
      within(dialog).getByText("Branch comparison unavailable until Git stats refresh."),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText("3 commits behind")).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(refreshes).toBe(2)
    expect(
      within(dialog).getByText("Branch comparison unavailable until Git stats refresh."),
    ).toBeInTheDocument()

    fireEvent.focus(window)
    await waitFor(() => expect(refreshes).toBe(3))
    act(() => finishRefresh?.(json(nextState)))
    await waitFor(() => expect(within(dialog).getByText("Behind main (local)")).toBeInTheDocument())
    expect(within(dialog).getByText("1 commit behind")).toBeInTheDocument()
    view.unmount()
  })
  it("withholds comparison when the displayed SHA changes on the same branch", async () => {
    const storedState = {
      name: "First",
      stats: {
        repository: "github/prototype",
        branch: "prototype/first",
        commitSha: "old-commit",
        comparison: { branch: "origin/main", source: "upstream", behind: 3, error: null },
      },
    }
    let hubCommitSha = "old-commit"
    let refreshes = 0
    let finishRefresh: ((response: Response) => void) | undefined
    function json(data: object) {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (isHubStatusRequest(path))
          return Promise.resolve(
            json({
              state: "connected",
              repository: "github/prototype",
              branch: "prototype/first",
              commitSha: hubCommitSha,
            }),
          )
        if (path === "/api/refresh") {
          refreshes += 1
          if (refreshes === 1) return Promise.resolve(json(storedState))
          return new Promise<Response>((resolve) => {
            finishRefresh = resolve
          })
        }
        return Promise.resolve(json(storedState))
      }),
    )
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })

    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "prototype/first" })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole("button", { name: "prototype/first" }))
    const dialog = screen.getByRole("dialog", { name: "Build details" })
    expect(within(dialog).getByText("3 commits behind")).toBeInTheDocument()

    hubCommitSha = "new-commit"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(within(dialog).getByText("prototype/first")).toBeInTheDocument()
    expect(
      within(dialog).getByText("Branch comparison unavailable until Git stats refresh."),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText("3 commits behind")).not.toBeInTheDocument()
    expect(refreshes).toBe(2)

    act(() =>
      finishRefresh?.(
        new Response(JSON.stringify({ error: "Cannot read Git stats." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )
    await waitFor(() => expect(screen.getByText("Cannot read Git stats.")).toBeInTheDocument())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(refreshes).toBe(2)
    expect(
      within(dialog).getByText("Branch comparison unavailable until Git stats refresh."),
    ).toBeInTheDocument()
    view.unmount()
  })
  it("preserves a detached-checkout error while an earlier Hub branch is still cached", async () => {
    const oldState = {
      name: "First",
      stats: {
        repository: "github/prototype",
        branch: "prototype/first",
        commitSha: "old-commit",
        comparison: { branch: "origin/main", source: "upstream", behind: 3, error: null },
      },
    }
    const detachedError = "The current Git checkout has a detached HEAD."
    const detachedState = {
      ...oldState,
      stats: {
        ...oldState.stats,
        branch: null,
        branchError: detachedError,
        commitSha: "new-commit",
        comparison: { branch: null, source: null, behind: null, error: detachedError },
      },
    }
    function json(data: object) {
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    let hubReads = 0
    let refreshes = 0
    let finishHubStatus: ((response: Response) => void) | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (isHubStatusRequest(path)) {
          hubReads += 1
          if (hubReads === 1)
            return Promise.resolve(
              json({
                state: "connected",
                repository: "github/prototype",
                branch: "prototype/first",
                commitSha: "old-commit",
              }),
            )
          return new Promise<Response>((resolve) => {
            finishHubStatus = resolve
          })
        }
        if (path === "/api/refresh") {
          refreshes += 1
          return Promise.resolve(json(refreshes === 1 ? oldState : detachedState))
        }
        return Promise.resolve(json(detachedState))
      }),
    )
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "prototype/first" })).toBeEnabled(),
    )
    await waitFor(() => expect(hubReads).toBe(1))
    fireEvent.click(screen.getByRole("button", { name: "prototype/first" }))
    const dialog = screen.getByRole("dialog", { name: "Build details" })
    expect(within(dialog).getByText("3 commits behind")).toBeInTheDocument()

    fireEvent.focus(window)
    await waitFor(() => expect(refreshes).toBe(2))
    await waitFor(() => expect(screen.getByRole("button", { name: "First" })).toBeEnabled())
    expect(within(dialog).getAllByText(detachedError)).toHaveLength(2)
    expect(within(dialog).queryByText("3 commits behind")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "First" })).toHaveAttribute(
      "title",
      expect.stringContaining("new-com"),
    )

    act(() => finishHubStatus?.(json({ state: "unavailable", message: "Open a named branch." })))
    await waitFor(() => expect(hubReads).toBe(2))
    expect(within(dialog).getAllByText(detachedError)).toHaveLength(2)
    view.unmount()
  })
})
