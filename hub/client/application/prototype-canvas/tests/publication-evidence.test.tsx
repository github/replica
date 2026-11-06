import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { isHubStatusRequest } from "./is-hub-status-request"
import { App } from ".."

describe("App()", () => {
  it("does not show an older successful Build as the current checkout's publication", async () => {
    const currentSha = "b".repeat(40)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/hub/events") throw new Error("No live connection")
        return Promise.resolve(
          new Response(
            JSON.stringify(
              isHubStatusRequest(path)
                ? {
                    state: "connected",
                    repository: "github/prototype",
                    branch: "prototype/first",
                    commitSha: currentSha,
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
                      buildState: "queued",
                      versionCount: 1,
                      build: {
                        url: "https://hub.example.com/build/1",
                        number: 1,
                        commitSha: "a".repeat(40),
                        publishedAt: "2026-09-28T11:00:00Z",
                        author: { login: "octocat", name: null, avatarUrl: null },
                      },
                    },
                  }
                : path === "/api/hub/comments"
                  ? { comments: [], hasMore: false, nextCursor: null }
                  : {
                      name: "First",
                      stats: {
                        repository: "github/prototype",
                        branch: "prototype/first",
                        commitSha: currentSha,
                        replicaWorkflowExists: true,
                        remoteBranch: {
                          state: "present",
                          repository: "github/prototype",
                          branch: "prototype/first",
                          commitSha: currentSha,
                          remoteSha: currentSha,
                        },
                        workflow: {
                          state: "succeeded",
                          detail: "The workflow succeeded.",
                          run: {
                            headSha: currentSha,
                            headBranch: "prototype/first",
                            status: "completed",
                            conclusion: "success",
                          },
                        },
                      },
                      publishStatus: { state: "published", detail: "The workflow succeeded." },
                    },
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )
      }),
    )
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
    expect(screen.getByRole("button", { name: "Awaiting Hub" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(screen.getByRole("link", { name: "Build #1" })).toHaveAttribute(
      "href",
      "https://hub.example.com/build/1",
    )
    expect(screen.queryByRole("button", { name: "Published" })).not.toBeInTheDocument()
    view.unmount()
  })
  it("shows a failed run for the pushed commit while keeping the prior Build accessible", async () => {
    const commitSha = "b".repeat(40)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/hub/events") throw new Error("No live connection")
        return Promise.resolve(
          new Response(
            JSON.stringify(
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
                      viewerLogin: "octocat",
                      registered: true,
                      canEdit: true,
                      canRegister: true,
                      published: true,
                      buildState: "failed",
                      versionCount: 1,
                      build: {
                        url: "https://hub.example.com/build/1",
                        number: 1,
                        commitSha: "a".repeat(40),
                        publishedAt: "2026-09-28T11:00:00Z",
                        author: { login: "octocat", name: null, avatarUrl: null },
                      },
                    },
                  }
                : path === "/api/hub/comments"
                  ? { comments: [], hasMore: false, nextCursor: null }
                  : {
                      name: "First",
                      publishStatus: {
                        state: "failed",
                        detail: "The latest Replica workflow failed.",
                      },
                      stats: {
                        repository: "github/prototype",
                        branch: "prototype/first",
                        commitSha,
                        replicaWorkflowExists: true,
                        remoteBranch: {
                          state: "present",
                          repository: "github/prototype",
                          branch: "prototype/first",
                          commitSha,
                          remoteSha: commitSha,
                        },
                        workflow: {
                          state: "failed",
                          detail: "The latest Replica workflow failed.",
                          run: {
                            headSha: commitSha,
                            headBranch: "prototype/first",
                            status: "completed",
                            conclusion: "failure",
                          },
                        },
                      },
                    },
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        )
      }),
    )
    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry publish" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(screen.getByRole("link", { name: "Build #1" })).toHaveAttribute(
      "href",
      "https://hub.example.com/build/1",
    )
    view.unmount()
  })
})
