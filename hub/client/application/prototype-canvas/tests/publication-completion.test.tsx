import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "./sharing-fixture"
import { App } from ".."

describe("App()", () => {
  it("updates publication status after import and registration without opening a dialog", async () => {
    const { fixture, fetch } = sharingFixture()
    fixture.hub.discovery = {
      state: "valid",
      origin: "https://other.example.com",
      mismatch: true,
    }
    fixture.state.stats.workingTree = "changed"
    fixture.remember = true
    const respond = fetch.getMockImplementation()!
    let finishPublish!: (response: Response) => void
    fetch.mockImplementation((path: string) =>
      path === "/api/publish"
        ? new Promise<Response>((resolve) => {
            finishPublish = resolve
          })
        : respond(path),
    )
    const view = render(
      <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
    )
    const publish = await screen.findByRole("button", { name: "Publish" })
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    const frame = screen.getByTitle("Demo prototype")
    fireEvent.click(publish)
    expect(publish).toHaveAttribute("aria-busy", "true")
    expect(publish).toBeDisabled()
    fireEvent.click(publish)
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([path]) => path === "/api/publish")).toHaveLength(1),
    )
    fixture.state.publishRequest = {
      state: "requested",
      requestedAt: new Date().toISOString(),
      commitSha: fixture.state.stats.commitSha,
    }
    await act(async () => {
      finishPublish(new Response(JSON.stringify({ message: "Requested" })))
      await Promise.resolve()
    })
    await waitFor(() => expect(publish).toHaveAttribute("aria-busy", "true"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    // Publishing may commit the local changes before pushing the branch.
    const sha = "b".repeat(40)
    fixture.state = {
      ...publicationState,
      stats: {
        ...publicationState.stats,
        commitSha: sha,
        remoteBranch: { ...publicationState.stats.remoteBranch!, commitSha: sha, remoteSha: sha },
        workflow: {
          state: "succeeded",
          detail: "Workflow succeeded",
          run: { headSha: sha, headBranch: publicationState.stats.branch, status: "completed" },
        },
      },
    }
    fixture.hub = { ...publicationHub, discovery: fixture.hub.discovery, commitSha: sha }
    fireEvent.focus(window)
    const awaiting = await screen.findByRole("button", { name: "Awaiting Hub" })
    expect(awaiting).toHaveAttribute("aria-busy", "true")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const build = { ...importedPrototype.build!, commitSha: sha }
    fixture.hub = {
      ...fixture.hub,
      state: "connected",
      prototype: { ...importedPrototype, build, registered: false, published: false },
    }
    fireEvent.focus(window)
    await screen.findByRole("button", { name: "Publishing" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    fixture.hub.prototype = { ...importedPrototype, build }
    fireEvent.focus(window)
    const published = await screen.findByRole("button", { name: "Published" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Hub" })).not.toBeInTheDocument()
    expect(published).toHaveAttribute("aria-busy", "false")
    expect(published).toBeEnabled()
    expect(published).toHaveAccessibleDescription("Latest changes already published")
    expect(screen.getByTitle("Demo prototype")).toBe(frame)
    fireEvent.focus(window)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    fireEvent.click(published)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    view.unmount()
  })
  it.each(["branch", "repository", "hub", "failure"])(
    "does not open publication success after a %s change or failure",
    async (change) => {
      const { fixture } = sharingFixture()
      const view = render(
        <App config={{ name: "Demo", prototypeUrl: "http://localhost:4321/", token: "local" }} />,
      )
      fireEvent.click(await screen.findByRole("button", { name: "Publish" }))
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Publish" })).toHaveAttribute(
          "aria-busy",
          "true",
        ),
      )
      const branch = change === "branch" ? "another-branch" : publicationState.stats.branch
      const repository =
        change === "repository" ? "github/another" : publicationState.stats.repository
      fixture.state = {
        ...publicationState,
        stats: {
          ...publicationState.stats,
          branch,
          repository,
          remoteBranch: {
            ...publicationState.stats.remoteBranch!,
            branch: branch!,
            repository: repository!,
          },
          workflow:
            change === "failure"
              ? {
                  state: "failed",
                  detail: "Build failed",
                  run: {
                    headSha: publicationState.stats.commitSha,
                    headBranch: branch,
                    conclusion: "failure",
                  },
                }
              : publicationState.stats.workflow,
        },
      }
      fixture.hub = {
        ...publicationHub,
        branch,
        repository,
        hubOrigin: change === "hub" ? "https://another.example.com" : publicationHub.hubOrigin,
      }
      fireEvent.focus(window)
      await screen.findByRole("button", {
        name: change === "failure" ? "Retry publish" : "Awaiting build",
      })
      fixture.hub = {
        ...fixture.hub,
        state: "connected",
        prototype: { ...importedPrototype, branch: branch! },
      }
      fireEvent.focus(window)
      await screen.findByRole("button", { name: "Published" })
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      view.unmount()
    },
  )
})
