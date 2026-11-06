import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { publicationExamples, publicationHub } from "@utils/resolve-prototype-publication/fixtures"
import { isHubStatusRequest } from "./is-hub-status-request"
import { publishPreparation } from "@utils/resolve-prototype-publication/fixtures"
import { App } from ".."

describe("App()", () => {
  it("shares Publish between sidebar and toolbar without duplicate dispatch or implicit Git operations", async () => {
    let state = structuredClone(publicationExamples["Unpublished branch"]!.state!)
    state.stats.workingTree = "clean"
    let finishPublish: (() => void) | undefined
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (input === "/api/publish/prepare")
        return Promise.resolve(Response.json(publishPreparation(state)))
      if (input === "/api/publish") {
        return new Promise<Response>((resolve) => {
          finishPublish = () => {
            state = {
              ...state,
              publishRequest: {
                state: "requested",
                requestedAt: new Date().toISOString(),
                commitSha: state.stats.commitSha,
              },
            }
            resolve(
              new Response(
                JSON.stringify({
                  message:
                    "Publish requested. Copilot will push this branch, register it, and return the Hub Build URL.",
                }),
              ),
            )
          }
        })
      }
      return Promise.resolve(
        new Response(JSON.stringify(isHubStatusRequest(input) ? publicationHub : state)),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const view = render(
      <App
        config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "test-token" }}
      />,
    )
    const toolbarPublish = await screen.findByRole("button", { name: "Publish" })
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const sidebar = screen.getByRole("complementary", { name: "Hub" })
    expect(
      within(sidebar).getByText("This branch won't appear in the hub until you publish."),
    ).toBeInTheDocument()
    expect(within(sidebar).queryByText(/committed files only/)).not.toBeInTheDocument()
    fireEvent.click(within(sidebar).getByRole("button", { name: "Publish" }))
    expect(toolbarPublish).toBeDisabled()
    fireEvent.click(toolbarPublish)
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
    )
    await act(async () => {
      finishPublish!()
      await Promise.resolve()
    })
    await waitFor(() =>
      expect(within(sidebar).getByRole("button", { name: "Waiting for Copilot" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    )
    expect(within(sidebar).getByRole("button", { name: "Waiting for Copilot" })).toBeDisabled()
    expect(
      within(sidebar).getByText(
        "Copilot received the publish request in chat and has not pushed this branch yet. Follow its progress in chat.",
      ),
    ).toBeInTheDocument()
    expect(
      within(sidebar).queryByText(/Uncommitted changes are not included/),
    ).not.toBeInTheDocument()
    expect(within(sidebar).queryByText(/confirm.*push/i)).not.toBeInTheDocument()
    expect(fetch.mock.calls.some(([path]) => path === "/api/hub/connect")).toBe(false)
    view.unmount()
  })
  it("retries unknown publication evidence from the sidebar without dispatching a publish", async () => {
    const example = publicationExamples["Remote check failed"]!
    const fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify(isHubStatusRequest(input) ? example.hub : example.state)),
      ),
    )
    vi.stubGlobal("fetch", fetch)
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Retry status" })
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    fireEvent.click(
      within(screen.getByRole("complementary", { name: "Hub" })).getByRole("button", {
        name: "Retry status",
      }),
    )
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/refresh")).toHaveLength(2),
    )
    expect(fetch.mock.calls.some(([path]) => path === "/api/publish")).toBe(false)
    view.unmount()
  })
  it("shows a failed dispatch inline and permits a deliberate retry", async () => {
    const example = publicationExamples["Unpublished branch"]!
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (input === "/api/publish/prepare")
        return Promise.resolve(
          Response.json({ ...publishPreparation(example.state!), workingTree: "clean" }),
        )
      if (input === "/api/publish") return Promise.reject(new Error("Copilot is offline"))
      return Promise.resolve(
        new Response(JSON.stringify(isHubStatusRequest(input) ? example.hub : example.state)),
      )
    })
    vi.stubGlobal("fetch", fetch)
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await screen.findByRole("button", { name: "Publish" })
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const sidebar = screen.getByRole("complementary", { name: "Hub" })
    fireEvent.click(within(sidebar).getByRole("button", { name: "Publish" }))
    await within(sidebar).findByText("Copilot is offline")
    fireEvent.click(within(sidebar).getByRole("button", { name: "Retry publish" }))
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(2),
    )
    view.unmount()
  })
  it("keeps a requested publish pending while Hub awaits an imported Build", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url
        if (path === "/api/hub/events") throw new Error("No live connection")
        const data = isHubStatusRequest(path)
          ? {
              state: "connected",
              repository: "github/prototype",
              branch: "prototype/first",
              prototype: {
                id: 1,
                repositoryId: 2001,
                branch: "prototype/first",
                name: "Welcome prototype",
                description: null,
                viewerLogin: "octocat",
                registered: true,
                canEdit: true,
                canRegister: true,
                published: false,
                build: null,
                buildState: "queued",
                versionCount: 0,
              },
            }
          : path === "/api/hub/comments"
            ? { comments: [], hasMore: false, nextCursor: null }
            : {
                name: "First",
                sessionId: "session-123",
                publishStatus: { state: "requested", detail: "Copilot received the request." },
                publishRequest: {
                  state: "requested",
                  requestedAt: new Date().toISOString(),
                  commitSha: "a".repeat(40),
                },
                stats: {
                  commitSha: "a".repeat(40),
                  remoteBranch: {
                    state: "absent",
                    repository: "github/prototype",
                    branch: "prototype/first",
                    commitSha: "a".repeat(40),
                  },
                  repository: "github/prototype",
                  branch: "prototype/first",
                  comparison: { branch: "main", source: "local", behind: 0, error: null },
                },
              }
        return Promise.resolve(
          new Response(JSON.stringify(data), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }),
    )

    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Waiting for Copilot" })).toBeDisabled(),
    )
    const hubButton = screen.getByRole("button", { name: "Edit details" })
    fireEvent.click(hubButton)
    const closeHub = within(screen.getByRole("complementary", { name: "Hub" })).getByRole(
      "button",
      {
        name: "Close Hub",
      },
    )
    expect(closeHub).toHaveFocus()
    expect(closeHub).toHaveClass("hub-sidebar__close", "hub-icon-button--invisible")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    expect(hubButton).toHaveFocus()
    fireEvent.click(hubButton)
    fireEvent.click(screen.getByRole("button", { name: "Close Hub" }))
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    expect(hubButton).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Welcome prototype" }))
    expect(screen.getByRole("dialog", { name: "Build details" })).toBeInTheDocument()
    expect(screen.getByText("session-123")).toBeInTheDocument()
    view.unmount()
  })
  it("updates Hub registration as soon as Publish registers the branch", async () => {
    let registered = false
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (path === "/api/hub/events") throw new Error("No live connection")
      if (path === "/api/publish") registered = true
      const data =
        path === "/api/publish/prepare"
          ? publishPreparation({
              name: "First",
              stats: {
                repository: "github/prototype",
                branch: "prototype/first",
                commitSha: "a".repeat(40),
                workingTree: "clean",
              },
            })
          : isHubStatusRequest(path)
            ? {
                state: "connected",
                repository: "github/prototype",
                branch: "prototype/first",
                prototype: {
                  id: 1,
                  repositoryId: 2001,
                  branch: "prototype/first",
                  name: registered ? "First" : null,
                  description: null,
                  viewerLogin: "octocat",
                  registered,
                  canEdit: true,
                  canRegister: true,
                  published: false,
                  build: null,
                  buildState: null,
                  versionCount: 0,
                },
              }
            : path === "/api/hub/comments"
              ? { comments: [], hasMore: false, nextCursor: null }
              : path === "/api/publish"
                ? { message: "Publish requested." }
                : {
                    name: "First",
                    publishStatus: { state: registered ? "requested" : "not_published" },
                    stats: {
                      repository: "github/prototype",
                      branch: "prototype/first",
                      commitSha: "a".repeat(40),
                      replicaWorkflowExists: true,
                      remoteBranch: {
                        state: "absent",
                        repository: "github/prototype",
                        branch: "prototype/first",
                        commitSha: "a".repeat(40),
                      },
                    },
                  }
      return Promise.resolve(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
    })
    vi.stubGlobal("fetch", fetch)

    const view = render(
      <App config={{ name: "First", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    await waitFor(() => expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(screen.queryByRole("button", { name: "Register prototype" })).not.toBeInTheDocument()
    const sidebar = screen.getByRole("complementary", { name: "Hub" })
    expect(within(sidebar).queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole("button", { name: "Publish" })[0]!)

    await waitFor(() =>
      expect(within(sidebar).getByRole("button", { name: "Edit details" })).toBeVisible(),
    )
    expect(fetch.mock.calls.filter(([path]) => path === "/api/hub/status")).toHaveLength(1)
    view.unmount()
  })
})
