import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { HubPrototype, PrototypeState } from "@utils/prototype-canvas/types"
import { isHubStatusRequest } from "./is-hub-status-request"
import { publishPreparation } from "@utils/resolve-prototype-publication/fixtures"
import { App } from ".."

describe("App()", () => {
  it("updates publication when Hub imports the pushed commit without claiming an earlier Build", async () => {
    const previousSha = "a".repeat(40)
    const pushedSha = "b".repeat(40)
    const requestedAt = new Date().toISOString()
    const oldBuild: NonNullable<HubPrototype["build"]> = {
      url: "https://hub.example.com/build/1",
      number: 1,
      commitSha: previousSha,
      publishedAt: "2026-09-28T11:00:00Z",
      author: { login: "octocat", name: null, avatarUrl: null },
    }
    let build = oldBuild
    let commitSha = previousSha
    let currentState: PrototypeState = {
      name: "First",
      publishRequest: {
        state: "requested",
        requestedAt,
        commitSha: previousSha,
        buildNumber: 1,
      },
      publishStatus: { state: "requested", detail: "Copilot received the request." },
      stats: {
        repository: "github/prototype",
        branch: "prototype/first",
        commitSha: previousSha,
        replicaWorkflowExists: true,
        remoteBranch: {
          state: "present",
          repository: "github/prototype",
          branch: "prototype/first",
          commitSha: previousSha,
          remoteSha: previousSha,
        },
        workflow: { state: "succeeded", detail: "Earlier run" },
      },
    }
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
        if (path === "/api/hub/events") throw new Error("No live connection")
        if (path === "/api/publish/prepare")
          return Promise.resolve(json(publishPreparation(currentState)))
        return Promise.resolve(
          json(
            isHubStatusRequest(path)
              ? {
                  state: "connected",
                  repository: "github/prototype",
                  branch: "prototype/first",
                  commitSha,
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
                    published: true,
                    build,
                    buildState: "successful",
                    versionCount: build.number,
                  },
                }
              : path === "/api/hub/comments"
                ? { comments: [], hasMore: false, nextCursor: null }
                : currentState,
          ),
        )
      }),
    )
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Awaiting build" })).toBeDisabled(),
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(screen.getByRole("link", { name: "Build #1" })).toHaveAttribute("href", oldBuild.url)
    expect(screen.queryByRole("button", { name: "Published" })).not.toBeInTheDocument()

    currentState = {
      ...currentState,
      publishStatus: { state: "succeeded", detail: "An earlier workflow completed." },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByRole("button", { name: "Awaiting build" })).toBeDisabled()

    commitSha = pushedSha
    currentState = {
      ...currentState,
      stats: {
        ...currentState.stats,
        commitSha: pushedSha,
        remoteBranch: {
          ...currentState.stats.remoteBranch!,
          commitSha: pushedSha,
          remoteSha: pushedSha,
        },
        workflow: {
          state: "in_progress",
          detail: "Replica workflow is running.",
          run: { headSha: pushedSha, headBranch: "prototype/first", status: "in_progress" },
        },
      },
      publishStatus: { state: "in_progress", detail: "Replica workflow is running." },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Building" })[0]).toBeDisabled(),
    )
    expect(screen.getByRole("link", { name: "Build #1" })).toHaveAttribute("href", oldBuild.url)
    build = { ...oldBuild, publishedAt: "2026-09-28T12:08:00Z" }

    currentState = {
      ...currentState,
      stats: {
        ...currentState.stats,
        workflow: {
          state: "succeeded",
          detail: "Workflow completed.",
          run: {
            headSha: pushedSha,
            headBranch: "prototype/first",
            status: "completed",
            conclusion: "success",
          },
        },
      },
      publishStatus: { state: "succeeded", detail: "Workflow completed." },
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getAllByRole("button", { name: "Awaiting Hub" })[0]).toBeDisabled()
    expect(screen.getByRole("link", { name: "Build #1" })).toBeInTheDocument()

    build = {
      ...oldBuild,
      url: "https://hub.example.com/build/2",
      number: 2,
      commitSha: pushedSha,
      publishedAt: "2026-09-28T09:00:00Z",
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getAllByRole("button", { name: "Published" })[0]).toBeEnabled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Build #2" })).toHaveAttribute("href", build.url)
    view.unmount()
  })
})
