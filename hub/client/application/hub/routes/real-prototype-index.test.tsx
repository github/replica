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
  it("opens prototype details from the real index after sign-in", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const prototypeId = "22222222-2222-4222-8222-222222222222"
    const unknownPrototypeId = "33333333-3333-4333-8333-333333333333"
    const entraPrototypeId = "88888888-8888-4888-8888-888888888888"
    const fallbackPrototypeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    const unknownProviderPrototypeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
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
    const successfulBuild = {
      number: 1,
      repositoryId,
      prototypeId,
      state: "successful",
      commitSha: null,
      commitAuthorProvider: "github",
      commitAuthorIssuer: "https://github.com",
      commitAuthorProviderUserId: "mona-id",
      commitAuthorLogin: null,
      commitAuthorName: null,
      commitAuthorAvatarUrl: null,
      createdAt: "2026-11-10T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      previewUrl: null,
      desktopScreenshotUrl: null,
      narrowScreenshotUrl: null,
      failureSummary: null,
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
      http.get(
        `${window.location.origin}/api/repositories/${repositoryId}/prototypes/${prototypeId}`,
        ({ request }) => {
          const selectedBuild =
            new URL(request.url).searchParams.get("build") === "3"
              ? { ...successfulBuild, number: 3 }
              : successfulBuild
          return HttpResponse.json({
            repository,
            prototype: {
              id: prototypeId,
              repositoryId,
              name: "Welcome flow",
              branchName: "prototype/welcome",
              description: "A welcoming start.",
              authorProvider: "github",
              authorLogin: "mona",
              authorName: "Mona",
              canEdit: false,
              latestBuild: { number: 4, state: "running" },
              builds: [
                successfulBuild,
                { ...successfulBuild, number: 2, state: "failed" },
                { ...successfulBuild, number: 3 },
                { ...successfulBuild, number: 4, state: "running" },
              ],
            },
            selectedBuild,
            showPrototypeInfo: false,
          })
        },
      ),
      http.get(
        `${window.location.origin}/api/repositories/${repositoryId}/prototypes/:prototypeId`,
        ({ params }) => {
          const authors: Record<
            string,
            { authorProvider: string | null; authorLogin: string | null; authorName: string | null }
          > = {
            [entraPrototypeId]: {
              authorProvider: "entra",
              authorLogin: "mona@example.test",
              authorName: "Mona",
            },
            [fallbackPrototypeId]: {
              authorProvider: "entra",
              authorLogin: "sam@example.test",
              authorName: null,
            },
            [unknownProviderPrototypeId]: {
              authorProvider: null,
              authorLogin: "legacy-author",
              authorName: null,
            },
            [unknownPrototypeId]: { authorProvider: null, authorLogin: null, authorName: null },
          }
          const author = authors[String(params.prototypeId)]
          if (!author) return new HttpResponse(null, { status: 404 })
          return HttpResponse.json({
            repository,
            prototype: {
              id: params.prototypeId,
              repositoryId,
              name: "Design",
              branchName: "prototype/design",
              description: null,
              ...author,
              canEdit: false,
              latestBuild: null,
              builds: [],
            },
            selectedBuild: null,
            showPrototypeInfo: false,
          })
        },
      ),
      http.get(
        `${window.location.origin}/api/repositories/${repositoryId}/prototypes/:prototypeId/review-comments`,
        () => new HttpResponse(null, { status: 404 }),
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
    expect(detailLinks(results, repositoryId)).toHaveLength(3)
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
    expect(detailLinks(listResults, repositoryId)).toHaveLength(3)
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
    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get("q")).toBe("welcome")
      expect(router.state.navigation.state).toBe("idle")
    })

    fireEvent.click(screen.getByRole("link", { name: "Welcome flow" }))
    expect(
      await screen.findByText("Preview hosting is not available for this Build."),
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(
      `/repositories/${repositoryId}/prototypes/${prototypeId}`,
    )
    expect(screen.getByLabelText("By @mona").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/mona",
    )

    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument()
    expect(document.querySelector('form[action="/api/auth/session/sign-out"]')).not.toBeNull()
    expect(document.querySelector('form[action="/session"]')).toBeNull()

    const chooser = screen.getByRole("button", { name: /Build 1.*v1/i })
    function buildOption(name: RegExp) {
      if (chooser.getAttribute("aria-expanded") !== "true") fireEvent.click(chooser)
      return within(screen.getByRole("menu", { name: /Build 1/i })).getByRole("menuitem", { name })
    }
    const successful = buildOption(/v3.*Successful/i)
    const failed = buildOption(/v2.*Failed/i)
    const running = buildOption(/v4.*Running/i)
    const successfulLink = within(successful).getByRole("link")
    expect(successfulLink).toHaveAttribute(
      "href",
      `/repositories/${repositoryId}/prototypes/${prototypeId}?build=3`,
    )
    expect(failed).toHaveAttribute("aria-disabled", "true")
    expect(running).toHaveAttribute("aria-disabled", "true")
    expect(within(failed).queryByRole("link")).not.toBeInTheDocument()
    expect(within(running).queryByRole("link")).not.toBeInTheDocument()
    failed.focus()
    fireEvent.keyDown(failed, { key: "Enter" })
    fireEvent.click(buildOption(/v2.*Failed/i))
    const currentRunning = buildOption(/v4.*Running/i)
    currentRunning.focus()
    fireEvent.keyDown(currentRunning, { key: " " })
    fireEvent.click(buildOption(/v4.*Running/i))
    expect(chooser).toHaveAccessibleName(/Build 1.*v1/i)
    expect(router.state.location.pathname).toBe(
      `/repositories/${repositoryId}/prototypes/${prototypeId}`,
    )
    expect(router.state.location.search).toBe("")

    fireEvent.click(within(buildOption(/v3.*Successful/i)).getByRole("link"))
    await waitFor(() => expect(router.state.location.search).toBe("?build=3"))
    expect(await screen.findByText("Build 3 has no preview")).toBeVisible()
    await act(async () =>
      router.navigate(
        `/repositories/${repositoryId}/prototypes/${entraPrototypeId}?view=minimized`,
      ),
    )
    expect((await screen.findByLabelText("By Mona")).closest("a")).toBeNull()
    expect(document.querySelector(".review-workspace-layer")).toHaveAttribute(
      "data-minimized",
      "false",
    )
    await act(async () =>
      router.navigate(`/repositories/${repositoryId}/prototypes/${fallbackPrototypeId}`),
    )
    expect((await screen.findByLabelText("By sam@example.test")).closest("a")).toBeNull()
    await act(async () =>
      router.navigate(`/repositories/${repositoryId}/prototypes/${unknownProviderPrototypeId}`),
    )
    expect((await screen.findByLabelText("By legacy-author")).closest("a")).toBeNull()
    await act(async () =>
      router.navigate(`/repositories/${repositoryId}/prototypes/${unknownPrototypeId}`),
    )
    expect((await screen.findByLabelText("Unknown author")).closest("a")).toBeNull()
  }, 15_000)

  it("sends a member's draft edit in real mode and shows its registration without extra permissions", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const prototypeId = "22222222-2222-4222-8222-222222222222"
    const userId = "44444444-4444-4444-8444-444444444444"
    const repository = { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" }
    const path = `/repositories/${repositoryId}/prototypes/${prototypeId}`
    const details = {
      name: "🧪".repeat(255),
      description: "🌱".repeat(500),
      startPage: `/${"é".repeat(1020)}?q=1#hi`,
    }
    let submission: unknown
    let prototype = {
      id: prototypeId,
      repositoryId,
      name: "prototype/draft",
      branchName: "prototype/draft",
      description: null as string | null,
      startPage: "/",
      authorLogin: null as string | null,
      authorName: null as string | null,
      authorProvider: null as string | null,
      canEdit: true,
      latestBuild: null,
      builds: [],
    }
    const patch = vi.fn(async ({ request }: { request: Request }) => {
      const input = (await request.json()) as typeof details
      submission = input
      prototype = {
        ...prototype,
        ...input,
        authorLogin: "member@example.test",
        authorName: "Member",
        authorProvider: "entra",
      }
      return HttpResponse.json({ repository, prototype, selectedBuild: null })
    })
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json({
          authenticated: true,
          membershipId: "55555555-5555-4555-8555-555555555555",
          userId,
          provider: "entra",
          login: "member@example.test",
          name: "Member",
          role: "MEMBER",
        }),
      ),
      http.get(`${window.location.origin}/api/workspace`, () =>
        HttpResponse.json({
          viewer: {
            id: userId,
            provider: "entra",
            login: "member@example.test",
            name: "Member",
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
      http.get(`${window.location.origin}/api${path}`, () =>
        HttpResponse.json({ repository, prototype, selectedBuild: null }),
      ),
      http.get(
        `${window.location.origin}/api${path}/review-comments`,
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.patch(`${window.location.origin}/api${path}`, patch),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    const router = await renderApplication(path)

    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Branch from here" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Edit prototype listings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const editor = screen.getByRole("dialog", { name: "Edit prototype details" })
    fireEvent.change(within(editor).getByRole("textbox", { name: "Name" }), {
      target: { value: ` ${details.name} ` },
    })
    fireEvent.change(within(editor).getByRole("textbox", { name: "Description" }), {
      target: { value: ` ${details.description} ` },
    })
    fireEvent.change(within(editor).getByRole("textbox", { name: "Start page (optional)" }), {
      target: { value: details.startPage },
    })

    fireEvent.click(within(editor).getByRole("button", { name: "Save details" }))

    await waitFor(() => expect(editor).not.toBeInTheDocument())
    expect(patch).toHaveBeenCalledOnce()
    expect(submission).toEqual(details)
    expect(router.state.location.pathname).toBe(path)
    expect(screen.getByLabelText("By Member")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const reopened = screen.getByRole("dialog", { name: "Edit prototype details" })
    expect(within(reopened).getByRole("textbox", { name: "Name" })).toHaveValue(details.name)
    expect(within(reopened).getByRole("textbox", { name: "Description" })).toHaveValue(
      details.description,
    )
    expect(within(reopened).getByRole("textbox", { name: "Start page (optional)" })).toHaveValue(
      details.startPage,
    )
  }, 15_000)

  it("retains a rejected real start page and retries with a cleared description and default route", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const repositoryId = "11111111-1111-4111-8111-111111111111"
    const prototypeId = "22222222-2222-4222-8222-222222222222"
    const userId = "44444444-4444-4444-8444-444444444444"
    const repository = { id: repositoryId, nameWithOwner: "team/design", defaultBranch: "main" }
    const path = `/repositories/${repositoryId}/prototypes/${prototypeId}`
    let prototype = {
      id: prototypeId,
      repositoryId,
      name: "Welcome",
      branchName: "prototype/welcome",
      description: "An existing description." as string | null,
      startPage: "/welcome",
      authorLogin: "another-author",
      canEdit: true,
      latestBuild: null,
      builds: [],
    }
    const submissions: unknown[] = []
    const patch = vi.fn(async ({ request }: { request: Request }) => {
      const input = (await request.json()) as {
        name: string
        description: string | null
        startPage: string
      }
      submissions.push(input)
      if (submissions.length === 1) {
        return HttpResponse.json(
          { error: "The API could not save the start page. Try again." },
          { status: 503 },
        )
      }
      prototype = { ...prototype, ...input }
      return HttpResponse.json({ repository, prototype, selectedBuild: null })
    })
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json({
          authenticated: true,
          membershipId: "55555555-5555-4555-8555-555555555555",
          userId,
          provider: "github",
          login: "member",
          name: "Member",
          role: "MEMBER",
        }),
      ),
      http.get(`${window.location.origin}/api/workspace`, () =>
        HttpResponse.json({
          viewer: {
            id: userId,
            provider: "github",
            login: "member",
            name: "Member",
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
      http.get(`${window.location.origin}/api${path}`, () =>
        HttpResponse.json({ repository, prototype, selectedBuild: null }),
      ),
      http.get(
        `${window.location.origin}/api${path}/review-comments`,
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.patch(`${window.location.origin}/api${path}`, patch),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())
    await renderApplication(path)
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }))
    const editor = screen.getByRole("dialog", { name: "Edit prototype details" })
    const name = within(editor).getByRole("textbox", { name: "Name" })
    const description = within(editor).getByRole("textbox", { name: "Description" })
    const startPage = within(editor).getByRole("textbox", { name: "Start page (optional)" })
    fireEvent.change(name, { target: { value: "Revised welcome" } })
    fireEvent.change(description, { target: { value: "Keep my unsaved description." } })
    fireEvent.change(startPage, { target: { value: "/welcome?step=2#intro" } })

    fireEvent.click(within(editor).getByRole("button", { name: "Save details" }))

    expect(await within(editor).findByRole("alert")).toHaveTextContent(
      "The API could not save the start page. Try again.",
    )
    expect(name).toHaveValue("Revised welcome")
    expect(description).toHaveValue("Keep my unsaved description.")
    expect(startPage).toHaveValue("/welcome?step=2#intro")
    expect(prototype.name).toBe("Welcome")
    expect(within(editor).getByRole("button", { name: "Save details" })).toBeEnabled()
    fireEvent.change(description, { target: { value: "   " } })
    fireEvent.change(startPage, { target: { value: "   " } })
    fireEvent.click(within(editor).getByRole("button", { name: "Save details" }))

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(editor).not.toBeInTheDocument())
    expect(submissions).toEqual([
      {
        name: "Revised welcome",
        description: "Keep my unsaved description.",
        startPage: "/welcome?step=2#intro",
      },
      { name: "Revised welcome", description: null, startPage: "/" },
    ])
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    const reopened = screen.getByRole("dialog", { name: "Edit prototype details" })
    expect(within(reopened).getByRole("textbox", { name: "Description" })).toHaveValue("")
    expect(within(reopened).getByRole("textbox", { name: "Start page (optional)" })).toHaveValue(
      "/",
    )
  }, 15_000)

  it("returns not-found for a standalone Build detail URL", async () => {
    vi.stubEnv("MODE", "development")
    vi.stubEnv("DEV", true)
    const buildPath = "/repositories/2001/prototypes/1/builds/3"
    const buildRead = vi.fn(() => HttpResponse.json({ error: "Build not found." }, { status: 404 }))
    const server = setupServer(
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json({
          authenticated: true,
          membershipId: "33333333-3333-4333-8333-333333333333",
          userId: "22222222-2222-4222-8222-222222222222",
          provider: "github",
          login: "octocat",
          name: "Octocat",
          role: "MEMBER",
        }),
      ),
      http.get(`${window.location.origin}/api${buildPath}`, buildRead),
    )
    server.listen({ onUnhandledRequest: "error" })
    onTestFinished(() => server.close())

    await renderApplication(buildPath)

    expect(await screen.findByRole("heading", { name: "Page or record not found" })).toBeVisible()
    expect(screen.getByText("404")).toBeVisible()
    expect(buildRead).not.toHaveBeenCalled()
  })

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
