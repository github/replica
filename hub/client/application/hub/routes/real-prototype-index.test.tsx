import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

function detailLinks(results: HTMLElement, repositoryId: string) {
  return [...results.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((link) =>
    new URL(link.href).pathname.startsWith(`/repositories/${repositoryId}/prototypes/`),
  )
}

function githubAuthorPaths(results: HTMLElement) {
  return [...results.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .map((link) => new URL(link.href))
    .filter((url) => url.hostname === "github.com")
    .map((url) => url.pathname)
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

describe("real prototype index", () => {
  it("opens the first repository after sign-in without offering prototype details", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const prototypeId = "22222222-2222-4222-8222-222222222222"
    const unknownPrototypeId = "33333333-3333-4333-8333-333333333333"
    const entraPrototypeId = "88888888-8888-4888-8888-888888888888"
    const userId = "44444444-4444-4444-8444-444444444444"
    const authorId = "77777777-7777-4777-8777-777777777777"
    const entraAuthorId = "99999999-9999-4999-8999-999999999999"
    const repository = { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" }
    const viewer = {
      id: userId,
      provider: "entra",
      login: "member",
      name: "Member",
      avatarUrl: null,
    }
    const capabilities = {
      createPrototypes: false,
      reviewPrototypes: false,
      manageSharing: false,
      administerHub: false,
    }
    let signedIn = false
    const requests: string[] = []
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/providers`, () =>
        HttpResponse.json({ providers: ["github", "entra"] }),
      ),
      http.get(`${window.location.origin}/api/auth/session`, () =>
        signedIn
          ? HttpResponse.json({
              authenticated: true,
              membershipId: "55555555-5555-4555-8555-555555555555",
              userId,
              provider: "entra",
              login: viewer.login,
              name: viewer.name,
              role: "MEMBER",
            })
          : new HttpResponse(null, { status: 401 }),
      ),
      http.get(`${window.location.origin}/api/session`, () =>
        HttpResponse.json({ error: "This endpoint is unavailable in real mode." }, { status: 404 }),
      ),
      http.get(`${window.location.origin}/api/workspace`, () =>
        signedIn
          ? HttpResponse.json({
              viewer,
              capabilities,
              repositories: [
                repository,
                {
                  id: "66666666-6666-4666-8666-666666666666",
                  nameWithOwner: "team/another",
                  defaultBranch: "main",
                },
              ],
            })
          : new HttpResponse(null, { status: 401 }),
      ),
      http.get(`${window.location.origin}/api/repositories/${repositoryId}`, () =>
        signedIn
          ? HttpResponse.json({
              repository,
              prototypes: [
                {
                  id: prototypeId,
                  repositoryId,
                  name: "Welcome flow",
                  branchName: "prototype/welcome",
                  description: "A welcoming start.",
                  authorId,
                  authorLogin: "mona",
                  canEdit: false,
                  latestBuild: { number: 1, state: "queued" },
                  builds: [],
                },
                {
                  id: unknownPrototypeId,
                  repositoryId,
                  name: "Unattributed flow",
                  branchName: "prototype/unattributed",
                  description: null,
                  authorId: null,
                  authorLogin: null,
                  canEdit: false,
                  latestBuild: { number: 2, state: "successful" },
                  builds: [],
                },
                {
                  id: entraPrototypeId,
                  repositoryId,
                  name: "Design flow",
                  branchName: "prototype/design",
                  description: null,
                  authorId: entraAuthorId,
                  authorLogin: "mona@example.test",
                  canEdit: false,
                  latestBuild: null,
                  builds: [],
                },
              ],
              pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 3 },
              authors: [
                {
                  id: authorId,
                  provider: "github",
                  login: "mona",
                  name: "Mona",
                  avatarUrl: null,
                },
                {
                  id: entraAuthorId,
                  provider: "entra",
                  login: "mona@example.test",
                  name: "Mona",
                  avatarUrl: null,
                },
              ],
            })
          : new HttpResponse(null, { status: 401 }),
      ),
    )
    const searches: string[] = []
    server.events.on("request:start", ({ request }) => {
      const url = new URL(request.url)
      requests.push(url.pathname)
      searches.push(`${url.pathname}${url.search}`)
    })
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const router = await renderApplication("/")
    expect(
      await screen.findByRole("button", { name: "Sign in with Microsoft Entra" }),
    ).toBeInTheDocument()
    expect(requests).not.toContain("/api/workspace")
    expect(requests).not.toContain(`/api/repositories/${repositoryId}`)

    signedIn = true
    await act(async () => {
      await router.navigate("/repositories")
    })

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/repositories/${repositoryId}`),
    )
    const results = await screen.findByRole("region", { name: "Prototypes" })
    expect(within(results).getByText("Welcome flow")).toBeVisible()
    expect(within(results).getByText("Unattributed flow")).toBeVisible()
    expect(within(results).getByText("Unknown author").closest("a")).toBeNull()
    expect(within(results).getByText("By Mona").closest("a")).toBeNull()
    expect(detailLinks(results, repositoryId)).toHaveLength(0)
    expect(githubAuthorPaths(results)).toContain("/mona")
    expect(githubAuthorPaths(results).every((path) => path === "/mona")).toBe(true)
    expect(screen.getByRole("button", { name: "User: All users" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /build prototype/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /build prototype/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /edit prototype listings/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /edit prototype listings/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Gallery view" })).toBeChecked()
    expect(requests).not.toContain("/api/session")

    fireEvent.click(screen.getByRole("radio", { name: "List view" }))
    await waitFor(() => expect(screen.getByRole("radio", { name: "List view" })).toBeChecked())
    const listResults = await screen.findByRole("region", { name: "Prototypes" })
    expect(within(listResults).getByText("Welcome flow")).toBeVisible()
    expect(within(listResults).getByText("Unattributed flow")).toBeVisible()
    expect(within(listResults).getByText("Unknown author").closest("a")).toBeNull()
    expect(within(listResults).getByText("Mona").closest("a")).toBeNull()
    expect(detailLinks(listResults, repositoryId)).toHaveLength(0)
    expect(githubAuthorPaths(listResults)).toContain("/mona")
    expect(githubAuthorPaths(listResults).every((path) => path === "/mona")).toBe(true)
    expect(within(listResults).getByRole("columnheader", { name: "Build" })).toBeVisible()
    expect(within(listResults).getByText("Queued")).toBeVisible()
    expect(within(listResults).getByText("passing")).toBeVisible()
    expect(within(listResults).getByText("No Build yet")).toBeVisible()

    const search = screen.getByRole("searchbox", { name: "Search prototypes" })
    fireEvent.change(search, { target: { value: " welcome " } })
    fireEvent.keyDown(search, { key: "Enter" })
    await waitFor(() => expect(searches).toContain(`/api/repositories/${repositoryId}?q=welcome`))
  }, 15_000)

  it("shows a repository failure instead of an empty index", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const userId = "22222222-2222-4222-8222-222222222222"
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json({
          authenticated: true,
          membershipId: "33333333-3333-4333-8333-333333333333",
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
          viewer: { id: userId, login: "octocat", name: "Octocat", avatarUrl: null },
          repositories: [{ id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" }],
          capabilities: {
            createPrototypes: false,
            reviewPrototypes: false,
            manageSharing: false,
            administerHub: false,
          },
        }),
      ),
      http.get(`${window.location.origin}/api/repositories/${repositoryId}`, () =>
        HttpResponse.json({ error: "Repository index unavailable." }, { status: 500 }),
      ),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    await renderApplication(`/repositories/${repositoryId}`)

    expect(await screen.findByText("Repository index unavailable.")).toBeVisible()
    expect(screen.queryByRole("heading", { name: "No prototypes yet" })).not.toBeInTheDocument()
  }, 15_000)

  it("keeps mock navigation and sign-out when the viewer has a provider", async () => {
    const [{ createFixtureSeed }, { createMockHandlers }, { createMockStore }, { renderHubFlow }] =
      await Promise.all([
        import("../mocks/create-fixture-seed"),
        import("../mocks/create-mock-handlers"),
        import("../mocks/create-mock-store"),
        import("./fixtures/render-hub-flow"),
      ])
    const seed = createFixtureSeed()
    seed.users = seed.users.map((user) =>
      user.login === "octocat" ? { ...user, provider: "entra" } : user,
    )
    const store = createMockStore({ origin: window.location.origin, seed })
    expect(store.getWorkspace().viewer.provider).toBe("entra")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001")

    expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toBeVisible()
    const navigation = screen.getByRole("navigation", { name: "Repository navigation" })
    expect(within(navigation).getByRole("link", { name: "Welcome" })).toBeVisible()
    const results = screen.getByRole("region", { name: "Prototypes" })
    expect(within(results).getByRole("link", { name: "Welcome" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: /^Account menu/ }))
    await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })))

    expect(router.state.location.pathname).toBe("/sign-in")
    expect(store.session.read().viewer).toBeNull()
  }, 15_000)
})
