import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import type { ComponentType } from "react"
import {
  createBrowserRouter,
  RouterProvider,
  useLoaderData,
  type ActionFunction,
  type LoaderFunction,
  type RouteObject,
} from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

type RouteModule = {
  default?: ComponentType<{ loaderData: unknown }>
  clientLoader?: LoaderFunction
  clientAction?: ActionFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
}

const routeModules = import.meta.glob<RouteModule>([
  "../root.tsx",
  "./**/index.tsx",
  "!./fixtures/**",
])

function applicationRoute(entry: RouteConfigEntry): RouteObject {
  const modulePath =
    entry.file === "root.tsx" ? "../root.tsx" : `./${entry.file.replace(/^routes\//, "")}`
  const loadModule = routeModules[modulePath]
  if (!loadModule) throw new Error(`Missing application route module: ${entry.file}`)
  const common = {
    id: entry.id ?? entry.file.replace(/\.tsx$/, ""),
    path: entry.path,
    lazy: async () => {
      const module = await loadModule()
      const Page = module.default
      return {
        loader: module.clientLoader,
        action: module.clientAction,
        ErrorBoundary: module.ErrorBoundary,
        HydrateFallback: module.HydrateFallback,
        Component: Page ? () => <Page loaderData={useLoaderData()} /> : undefined,
      }
    },
  }
  return entry.index
    ? { ...common, index: true }
    : { ...common, children: entry.children?.map(applicationRoute) }
}

async function renderApplication(path: string) {
  const [{ default: routes }, { HubThemeProvider }] = await Promise.all([
    import("../routes"),
    import("@hooks/use-hub-theme"),
  ])
  window.history.replaceState(null, "", path)
  const router = createBrowserRouter(
    [applicationRoute({ id: "root", file: "root.tsx", children: routes })],
    { window },
  )
  onTestFinished(() => router.dispose())
  await act(async () => {
    await vi.waitFor(() => expect(router.state.initialized).toBe(true), { timeout: 10_000 })
  })
  render(
    <HubThemeProvider>
      <RouterProvider router={router} />
    </HubThemeProvider>,
  )
  return router
}

describe("real Build history", () => {
  it("opens History from a pinned real Build and keeps that Build selected", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
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
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json({
          authenticated: true,
          membershipId: "55555555-5555-4555-8555-555555555555",
          userId,
          provider: "github",
          login: "octocat",
          name: "Octocat",
          role: "MEMBER",
        }),
      ),
      http.get(`${window.location.origin}/api/session`, () =>
        HttpResponse.json({ error: "This endpoint is unavailable in real mode." }, { status: 404 }),
      ),
      http.get(`${window.location.origin}/api/workspace`, () =>
        HttpResponse.json({
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
        const selected = new URL(request.url).searchParams.get("build") === "3"
        return HttpResponse.json({
          repository,
          prototype,
          selectedBuild: selected ? build(3, "successful") : null,
          showPrototypeInfo: false,
        })
      }),
      http.get(`${window.location.origin}/api${prototypePath}/review-comments`, () =>
        HttpResponse.json({ error: "Not found." }, { status: 404 }),
      ),
      http.get(`${window.location.origin}/api${prototypePath}/builds`, ({ request }) => {
        const page = new URL(request.url).searchParams.get("page") ?? "1"
        historyRequests.push(new URL(request.url).search)
        return HttpResponse.json({
          repository,
          prototype,
          builds: page === "1" ? builds : [build(1, "successful")],
          pagination: { page: Number(page), pageSize: 3, totalCount: 4, pageCount: 2 },
        })
      }),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const router = await renderApplication(`${prototypePath}?build=3`)
    expect(await screen.findByText("Build 3 has no preview")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "More actions" }))
    const historyLink = within(screen.getByRole("menuitem", { name: "History" })).getByRole("link")
    const historyUrl = new URL(historyLink.getAttribute("href") ?? "", window.location.origin)
    expect(historyUrl.pathname).toBe(`${prototypePath}/builds`)
    expect(historyUrl.searchParams.get("build")).toBe("3")
    fireEvent.click(historyLink)

    expect(await screen.findByRole("heading", { name: "History", level: 2 })).toBeVisible()
    expect(router.state.location.pathname).toBe(`${prototypePath}/builds`)
    expect(historyRequests).toEqual([""])
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

    fireEvent.click(screen.getByRole("link", { name: "Older Builds" }))
    expect(await screen.findByRole("link", { name: "Build 1" })).toBeVisible()
    expect(historyRequests).toEqual(["", "?page=2"])
    expect(screen.queryByRole("link", { name: "Older Builds" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Choose build, v3" }))
    const picker = screen.getByRole("menu")
    expect(within(picker).getByRole("menuitem", { name: /v3/ })).toHaveAttribute(
      "href",
      `${prototypePath}?build=3`,
    )
    expect(within(picker).getByRole("menuitem", { name: /v2/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    expect(within(picker).getByRole("menuitem", { name: /v4/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
    fireEvent.keyDown(picker, { key: "Escape" })
    fireEvent.click(screen.getByRole("link", { name: "Newest Builds" }))
    expect(await screen.findByRole("link", { name: "Build 3" })).toBeVisible()
    expect(historyRequests).toEqual(["", "?page=2", ""])
  }, 15_000)
})
