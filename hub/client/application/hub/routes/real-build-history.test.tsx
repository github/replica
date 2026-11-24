import { fireEvent, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { http, stubHubFetch } from "@/test/stub-hub-fetch"

import { renderHubFlow } from "./fixtures/render-hub-flow"

describe("real Build history", () => {
  it("opens History from a pinned real Build and keeps that Build selected", async () => {
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const prototypeId = "22222222-2222-4222-8222-222222222222"
    const userId = "44444444-4444-4444-8444-444444444444"
    const prototypePath = `/repositories/${repositoryId}/prototypes/${prototypeId}`
    const repository = { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" }
    function build(number: number, state: string) {
      return {
        number,
        repositoryId,
        prototypeId,
        state,
        commitSha: null,
        commitAuthorProvider: null,
        commitAuthorIssuer: null,
        commitAuthorProviderUserId: null,
        commitAuthorLogin: null,
        commitAuthorName: null,
        commitAuthorAvatarUrl: null,
        createdAt: `2026-11-0${number}T12:00:00.000Z`,
        startedAt: null,
        finishedAt: null,
        previewUrl: null,
        desktopScreenshotUrl: null,
        narrowScreenshotUrl: null,
        failureSummary: null,
      }
    }
    const builds = [build(4, "running"), build(3, "successful"), build(2, "failed")]
    const prototype = {
      id: prototypeId,
      repositoryId,
      name: "Welcome flow",
      branchName: "prototype/welcome",
      description: null,
      authorProvider: "github",
      authorLogin: "mona",
      authorName: "Mona",
      canEdit: true,
      startPage: "/welcome",
      latestBuild: { number: 4, state: "running" },
      builds: [...builds, build(1, "successful")],
    }
    const historyRequests: string[] = []
    const api = stubHubFetch(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        Response.json({
          authenticated: true,
          membershipId: "55555555-5555-4555-8555-555555555555",
          userId,
          provider: "github",
          login: "octocat",
          name: "Octocat",
          role: "MEMBER",
        }),
      ),
      http.get(`${window.location.origin}/api/workspace`, () =>
        Response.json({
          viewer: {
            id: userId,
            provider: "github",
            login: "octocat",
            name: "Octocat",
            avatarUrl: null,
          },
          repositories: [repository],
          capabilities: {
            createPrototypes: false,
            reviewPrototypes: false,
            manageSharing: false,
            administerHub: false,
          },
        }),
      ),
      http.get(`${window.location.origin}/api${prototypePath}`, ({ request }) => {
        const selected = Number(new URL(request.url).searchParams.get("build"))
        return Response.json({
          repository,
          prototype,
          selectedBuild: selected === 1 || selected === 3 ? build(selected, "successful") : null,
          showPrototypeInfo: false,
        })
      }),
      http.get(`${window.location.origin}/api${prototypePath}/review-comments`, () =>
        Response.json({ error: "Not found." }, { status: 404 }),
      ),
      http.get(`${window.location.origin}/api${prototypePath}/builds`, ({ request }) => {
        const url = new URL(request.url)
        const page = url.searchParams.get("page") ?? "1"
        const pageBuilds = page === "1" ? builds : [build(1, "successful")]
        const pinned = page === "2" && url.searchParams.get("build") === "3"
        historyRequests.push(url.search)
        return Response.json({
          repository,
          prototype: {
            ...prototype,
            builds: pinned ? [build(3, "successful"), ...pageBuilds] : pageBuilds,
          },
          builds: pageBuilds,
          pagination: { page: Number(page), pageSize: 3, totalCount: 4, pageCount: 2 },
        })
      }),
    )
    const router = await renderHubFlow(api, `${prototypePath}?build=3`)
    expect(await screen.findByText("Build 3 has no preview")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    const historyLink = within(screen.getByRole("menuitem", { name: "History" })).getByRole("link")
    const historyUrl = new URL(historyLink.getAttribute("href") ?? "", window.location.origin)
    expect(historyUrl.pathname).toBe(`${prototypePath}/builds`)
    expect(historyUrl.searchParams.get("build")).toBe("3")
    await router.settle(() => fireEvent.click(historyLink))

    expect(await screen.findByRole("heading", { name: "History", level: 2 })).toBeVisible()
    expect(router.state.location.pathname).toBe(`${prototypePath}/builds`)
    expect(historyRequests.map((query) => Object.fromEntries(new URLSearchParams(query)))).toEqual([
      { build: "3" },
    ])
    expect(screen.queryByRole("link", { name: "Analytics" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Learnings" })).not.toBeInTheDocument()
    expect(document.querySelector('form[action="/api/auth/session/sign-out"]')).not.toBeNull()
    expect(document.querySelector('form[action="/session"]')).toBeNull()
    const history = screen.getByRole("list", { name: "History" })
    const successful = within(history).getByRole("link", { name: "Build 3" })
    expect(new URL(successful.getAttribute("href") ?? "", window.location.origin)).toMatchObject({
      pathname: prototypePath,
      search: "?build=3",
    })
    expect(within(history).getByText("Build 2").closest("a")).toBeNull()
    expect(within(history).getByText("Build 4").closest("a")).toBeNull()
    const older = new URL(
      screen.getByRole("link", { name: "Older Builds" }).getAttribute("href") ?? "",
      window.location.origin,
    )
    expect(older.pathname).toBe(`${prototypePath}/builds`)
    expect(Object.fromEntries(older.searchParams)).toEqual({ page: "2", build: "3" })
    const close = new URL(
      screen.getByRole("link", { name: "Return to prototype" }).getAttribute("href") ?? "",
      window.location.origin,
    )
    expect(close.pathname).toBe(prototypePath)
    expect(close.searchParams.get("build")).toBe("3")
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v3" }))
    const firstPicker = screen.getByRole("menu")
    expect(within(firstPicker).getByRole("menuitem", { name: /v2/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(within(firstPicker).getByRole("menuitem", { name: /v4/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    fireEvent.keyDown(firstPicker, { key: "Escape" })

    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Older Builds" })))
    expect(await screen.findByRole("link", { name: "Build 1" })).toBeVisible()
    expect(historyRequests.map((query) => Object.fromEntries(new URLSearchParams(query)))).toEqual([
      { build: "3" },
      { page: "2", build: "3" },
    ])
    expect(screen.queryByRole("link", { name: "Older Builds" })).not.toBeInTheDocument()
    const olderClose = new URL(
      screen.getByRole("link", { name: "Return to prototype" }).getAttribute("href") ?? "",
      window.location.origin,
    )
    expect(olderClose.pathname).toBe(prototypePath)
    expect(olderClose.searchParams.get("build")).toBe("3")
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v3" }))
    const picker = screen.getByRole("menu")
    const selectedBuild = within(picker).getByRole("menuitem", { name: /v3/ })
    expect(within(selectedBuild).getByRole("link")).toHaveAttribute(
      "href",
      `${prototypePath}?build=3`,
    )
    expect(within(picker).getByRole("menuitem", { name: /v1/ })).toBeVisible()
    expect(within(picker).queryByRole("menuitem", { name: /v2/ })).not.toBeInTheDocument()
    expect(within(picker).queryByRole("menuitem", { name: /v4/ })).not.toBeInTheDocument()
    fireEvent.keyDown(picker, { key: "Escape" })
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Newest Builds" })))
    expect(await screen.findByRole("link", { name: "Build 3" })).toBeVisible()
    expect(historyRequests.map((query) => Object.fromEntries(new URLSearchParams(query)))).toEqual([
      { build: "3" },
      { page: "2", build: "3" },
      { build: "3" },
    ])
    await router.settle(() =>
      fireEvent.click(screen.getByRole("link", { name: "Return to prototype" })),
    )
    expect(await screen.findByText("Build 3 has no preview")).toBeVisible()
    expect(router.state.location.pathname).toBe(prototypePath)
    expect(router.state.location.search).toBe("?build=3")
  }, 15_000)
})
