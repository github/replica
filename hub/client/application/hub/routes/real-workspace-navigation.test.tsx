import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse, type HttpHandler, type JsonBodyType, ws } from "msw"
import { setupServer } from "msw/node"
import type { ComponentType } from "react"
import {
  createBrowserRouter,
  RouterProvider,
  useLoaderData,
  type LoaderFunctionArgs,
  type RouteObject,
  type ShouldRevalidateFunction,
} from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { RepositoryRecord, WorkspaceResponse } from "@application/hub/contracts/types"
import { HubThemeProvider } from "@hooks/use-hub-theme"

import routes from "../routes"

type RouteModule = {
  default?: ComponentType<{ loaderData: unknown }>
  clientLoader?: (args: LoaderFunctionArgs & { serverLoader: () => Promise<never> }) => unknown
  shouldRevalidate?: ShouldRevalidateFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
  handle?: unknown
}

const routeModules = import.meta.glob<RouteModule>(
  ["../root.tsx", "./**/index.tsx", "!./fixtures/**"],
  { eager: true },
)

function applicationRoute(entry: RouteConfigEntry): RouteObject {
  const path =
    entry.file === "root.tsx" ? "../root.tsx" : `./${entry.file.replace(/^routes\//, "")}`
  const module = routeModules[path]
  if (!module) throw new Error(`Missing application route module: ${entry.file}`)
  const {
    default: Page,
    clientLoader,
    shouldRevalidate,
    ErrorBoundary,
    HydrateFallback,
    handle,
  } = module
  const common = {
    id: entry.id ?? entry.file.replace(/\.tsx$/, ""),
    path: entry.path,
    loader: clientLoader
      ? (args: LoaderFunctionArgs) =>
          clientLoader({
            ...args,
            serverLoader: () => Promise.reject(new Error("Use the real Hub API.")),
          })
      : undefined,
    shouldRevalidate,
    Component: Page ? () => <Page loaderData={useLoaderData()} /> : undefined,
    ErrorBoundary,
    HydrateFallback,
    handle,
  }
  return entry.index
    ? { ...common, index: true }
    : { ...common, children: entry.children?.map(applicationRoute) }
}

async function renderApplication(path: string, handlers: Parameters<typeof setupServer>) {
  vi.stubEnv("MODE", "development")
  vi.stubEnv("DEV", true)
  const server = setupServer(...handlers)
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
  window.history.replaceState(null, "", path)
  const router = createBrowserRouter(
    [applicationRoute({ id: "root", file: "root.tsx", children: routes })],
    { window },
  )
  onTestFinished(() => router.dispose())
  await vi.waitFor(() => expect(router.state.initialized).toBe(true), { timeout: 10_000 })
  render(<RouterProvider router={router} />, { wrapper: HubThemeProvider })
  return router
}

function json(path: string, body: JsonBodyType): HttpHandler {
  return http.get(`${window.location.origin}${path}`, () => HttpResponse.json(body))
}

function workspaceApi(
  repositories: RepositoryRecord[],
  {
    provider = "github",
    respondToWorkspace,
    reviewInboxAvailable = false,
    role = "ADMINISTRATOR",
  }: {
    provider?: "github" | "local"
    respondToWorkspace?: (
      request: Request,
      workspace: WorkspaceResponse,
    ) => Response | Promise<Response>
    reviewInboxAvailable?: boolean
    role?: "MEMBER" | "ADMINISTRATOR"
  } = {},
) {
  const user = {
    provider,
    login: provider === "local" ? "local-developer" : "octocat",
    name: provider === "local" ? "Local developer" : "The Octocat",
  }
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const workspace = {
    viewer: { id: userId, ...user, avatarUrl: null },
    capabilities: {
      createPrototypes: false,
      reviewPrototypes: false,
      manageSharing: false,
      administerHub: role === "ADMINISTRATOR",
    },
    repositories,
    reviewInboxAvailable,
    welcomeHidden: false,
  }
  return [
    json("/api/auth/session", {
      authenticated: true,
      membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      userId,
      ...user,
      role,
      reviewInboxAvailable,
    }),
    http.get(`${window.location.origin}/api/workspace`, ({ request }) =>
      respondToWorkspace ? respondToWorkspace(request, workspace) : HttpResponse.json(workspace),
    ),
  ]
}

function galleryApi(repository: RepositoryRecord, onRead?: (request: Request) => void) {
  return http.get(`${window.location.origin}/api/repositories/${repository.id}`, ({ request }) => {
    onRead?.(request)
    return HttpResponse.json({
      repository,
      prototypes: [],
      authors: [],
      pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 0 },
    })
  })
}

function unreadMention(repository: RepositoryRecord, prototypeId: string) {
  return {
    id: 7,
    version: 1,
    actor: { login: "mona", name: "Mona", avatarUrl: null },
    kind: "mention",
    excerpt: "Please review the landing page.",
    createdAt: "2026-11-20T12:00:00.000Z",
    read: false,
    repository: repository.nameWithOwner,
    prototype: "Landing page",
    path: `/repositories/${repository.id}/prototypes/${prototypeId}?comment=7`,
    updatePath: "/api/notifications/7",
    target: { prototypeId, threadId: 7, commentId: 7 },
  }
}

function deferResponse() {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  onTestFinished(release)
  return { pending, release }
}

function selectedRepository(nameWithOwner: string) {
  return screen.findByRole("button", { name: `Choose repository. ${nameWithOwner} selected` })
}

function sidebarDestinations() {
  return screen
    .getAllByRole("navigation", {
      name: /^(Repository navigation|Hub navigation|Security and settings)$/,
    })
    .flatMap((menu) => within(menu).getAllByRole<HTMLAnchorElement>("link"))
    .map((link) => {
      const url = new URL(link.href)
      url.searchParams.sort()
      return url.pathname + url.search
    })
    .sort()
}

describe("real workspace navigation", () => {
  it("keeps the collapsed navigation and Inbox count across main pages", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const otherRepository = {
      ...repository,
      id: "22222222-2222-4222-8222-222222222222",
      nameWithOwner: "team/beta",
    }
    const galleryPath = `/repositories/${repository.id}`
    const createPath = `${galleryPath}/new`
    const inboxPath = `/notifications?repositoryId=${repository.id}`
    const galleryCount = 3
    const inboxCount = 1
    const notification = unreadMention(repository, "33333333-3333-4333-8333-333333333333")
    const inboxReads: [limit: string | null, unread: string | null][] = []
    const galleryReads: (string | null)[] = []
    await renderApplication(galleryPath, [
      ...workspaceApi([otherRepository, repository], {
        role: "MEMBER",
        reviewInboxAvailable: true,
      }),
      galleryApi(repository, (request) =>
        galleryReads.push(new URL(request.url).searchParams.get("q")),
      ),
      json(`/api/repositories/${repository.id}/templates`, {
        repository,
        templates: [],
        canCreate: true,
      }),
      http.get(`${window.location.origin}/api/notifications/inbox`, ({ request }) => {
        const query = new URL(request.url).searchParams
        const limit = query.get("limit")
        inboxReads.push([limit, query.get("unread")])
        return HttpResponse.json({
          notifications: [notification],
          nextBefore: limit === "1" ? notification.id : null,
          unreadCount: limit === "1" ? galleryCount : inboxCount,
        })
      }),
    ])

    function mainNavigation() {
      return screen.getByRole("navigation", { name: "Repository navigation" })
    }

    function navLink(name: string | RegExp) {
      return within(mainNavigation()).getByRole("link", { name })
    }

    function navInboxBadge(count: number) {
      return within(navLink(/^Inbox\b/)).queryByText(String(count))
    }

    await waitFor(() => expect(navInboxBadge(galleryCount)).toBeVisible())
    expect(inboxReads).toEqual([["1", "true"]])
    expect(navLink("Prototypes")).toHaveAttribute("aria-current", "page")
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))
    const originalNavigation = mainNavigation()

    function expectNavigation(destination: string, path: string) {
      const current = mainNavigation()
      expect.soft(current === originalNavigation, `Same navigation on ${destination}`).toBe(true)
      expect
        .soft(
          screen.queryByRole("button", { name: "Expand sidebar", expanded: false }) !== null,
          `Collapsed navigation on ${destination}`,
        )
        .toBe(true)
      expect(
        screen.getByRole("button", {
          name: `Choose repository. ${repository.nameWithOwner} selected`,
        }),
      ).toBeEnabled()
      expect(within(current).getByRole("link", { current: "page" })).toHaveAttribute("href", path)
      expect(window.location.pathname + window.location.search).toBe(path)
    }

    fireEvent.click(navLink("Create"))
    expect(await screen.findByRole("heading", { name: "What should we create?" })).toBeVisible()
    expectNavigation("Create", createPath)

    fireEvent.click(navLink(/^Inbox\b/))
    const inbox = await screen.findByRole("region", { name: "Inbox" })
    expect(await within(inbox).findByText(notification.excerpt)).toBeVisible()
    await waitFor(() => expect(navInboxBadge(inboxCount)).toBeVisible())
    expectNavigation("Inbox", inboxPath)

    fireEvent.click(navLink("Prototypes"))
    expect(await screen.findByRole("heading", { name: "Prototypes" })).toBeVisible()
    expectNavigation("Prototypes", galleryPath)
    expect.soft(navInboxBadge(inboxCount), "Inbox count after leaving the list").toBeVisible()

    const searchBox = screen.getByRole("searchbox", { name: "Search prototypes" })
    fireEvent.change(searchBox, { target: { value: "landing" } })
    fireEvent.keyDown(searchBox, { key: "Enter" })
    expect(await screen.findByRole("heading", { name: "No prototypes found" })).toBeVisible()
    expect(window.location.search).toBe("?q=landing")
    expect(galleryReads).toContain("landing")

    act(() => window.history.back())
    await waitFor(() =>
      expect(screen.getByRole("searchbox", { name: "Search prototypes" })).toHaveValue(""),
    )
    expect(window.location.pathname + window.location.search).toBe(galleryPath)
    expect(inboxReads).toEqual([
      ["1", "true"],
      ["50", null],
    ])
  }, 15_000)

  it("opens Create, Inbox, and Hub settings while repository permissions are pending", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const permission = deferResponse()
    const navigationReads = vi.fn()
    const permissionReads = vi.fn()
    const rosterRead = vi.fn()
    const inboxPath = `/notifications?repositoryId=${repository.id}`
    const createPath = `/repositories/${repository.id}/new`
    const router = await renderApplication(inboxPath, [
      ...workspaceApi([repository], {
        reviewInboxAvailable: true,
        async respondToWorkspace(request, workspace) {
          const query = new URL(request.url).searchParams
          if (query.get("view") === "navigation") {
            navigationReads()
            return HttpResponse.json({ ...workspace, repositoryPermissionsAvailable: true })
          }
          permissionReads(query.get("repositoryId"))
          await permission.pending
          return HttpResponse.json(workspace)
        },
      }),
      json("/api/notifications/inbox", { notifications: [], nextBefore: null, unreadCount: 0 }),
      http.get(`${window.location.origin}/api/administrators`, () => {
        rosterRead()
        return HttpResponse.json({ administrators: [], nextCursor: null })
      }),
      json(`/api/repositories/${repository.id}/templates`, {
        repository,
        templates: [],
        canCreate: true,
      }),
    ])
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeVisible()
    await waitFor(() => expect(permissionReads).toHaveBeenCalledExactlyOnceWith(repository.id))

    fireEvent.click(screen.getByRole("link", { name: "Create" }))
    expect(await screen.findByRole("heading", { name: "What should we create?" })).toBeVisible()
    expect(router.state.location.pathname).toBe(createPath)

    fireEvent.click(screen.getByRole("link", { name: "Inbox" }))
    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeVisible()
    expect(router.state.location.pathname + router.state.location.search).toBe(inboxPath)
    expect(navigationReads).toHaveBeenCalledTimes(3)
    expect(permissionReads).toHaveBeenCalledExactlyOnceWith(repository.id)

    fireEvent.click(screen.getByRole("link", { name: "Hub administrators" }))
    await vi.waitFor(() => expect(rosterRead).toHaveBeenCalledOnce())
    expect(await screen.findByRole("heading", { name: "Hub administrators" })).toBeVisible()
    expect(router.state.location.pathname).toBe("/settings/administrators")
    expect(navigationReads).toHaveBeenCalledTimes(4)
    expect(permissionReads).toHaveBeenCalledExactlyOnceWith(repository.id)
  })

  it("refreshes the workspace when switching repositories and ignores a late grant for the old repository", async () => {
    const first = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const next = {
      ...first,
      id: "22222222-2222-4222-8222-222222222222",
      nameWithOwner: "team/beta",
    }
    const firstPermission = deferResponse()
    const nextPermission = deferResponse()
    const grants = new Map([
      [first.id, { permission: firstPermission, capabilities: { administerRepository: true } }],
      [next.id, { permission: nextPermission, capabilities: { managePrototypeListings: true } }],
    ])
    const navigationReads = vi.fn()
    const permissionReads = new Map<string, AbortSignal>()
    await renderApplication(`/repositories/${first.id}`, [
      ...workspaceApi([first, next], {
        role: "MEMBER",
        async respondToWorkspace(request, workspace) {
          const query = new URL(request.url).searchParams
          if (query.get("view") === "navigation") {
            navigationReads()
            return HttpResponse.json({ ...workspace, repositoryPermissionsAvailable: true })
          }
          const repositoryId = query.get("repositoryId") ?? ""
          const grant = grants.get(repositoryId)
          if (!grant) return HttpResponse.json({ error: "Repository not found" }, { status: 404 })
          permissionReads.set(repositoryId, request.signal)
          await grant.permission.pending
          return HttpResponse.json({
            ...workspace,
            repositories: workspace.repositories.map((repository) =>
              repository.id === repositoryId
                ? {
                    ...repository,
                    capabilities: { ...repository.capabilities, ...grant.capabilities },
                  }
                : repository,
            ),
          })
        },
      }),
      galleryApi(first),
      galleryApi(next),
    ])
    await waitFor(() => expect([...permissionReads.keys()]).toEqual([first.id]))

    fireEvent.click(await selectedRepository(first.nameWithOwner))
    fireEvent.click(await screen.findByRole("link", { name: next.nameWithOwner }))
    expect(await selectedRepository(next.nameWithOwner)).toBeVisible()
    await waitFor(() => expect([...permissionReads.keys()]).toEqual([first.id, next.id]))
    expect(navigationReads).toHaveBeenCalledTimes(2)
    expect(permissionReads.get(first.id)?.aborted).toBe(true)
    expect(screen.queryByRole("link", { name: "Edit prototype listings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Security audit" })).not.toBeInTheDocument()

    nextPermission.release()
    const editListings = await screen.findByRole("link", { name: "Edit prototype listings" })
    expect(editListings).toHaveAttribute("href", `/repositories/${next.id}/prototypes/manage`)

    await act(() => {
      firstPermission.release()
      return firstPermission.pending
    })
    expect(screen.getByRole("link", { name: "Edit prototype listings" })).toBeVisible()
    expect(screen.queryByRole("link", { name: "Security audit" })).not.toBeInTheDocument()
  })

  it("refreshes repository choices on a search change but skips idle clicks on the current URL", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const galleryPath = `/repositories/${repository.id}`
    const galleryReads = vi.fn<(query: string | null) => void>()
    const workspaceReads = vi.fn()
    const removedRepository = {
      ...repository,
      id: "22222222-2222-4222-8222-222222222222",
      nameWithOwner: "team/beta",
    }
    let repositories = [repository, removedRepository]
    const router = await renderApplication(`${galleryPath}?q=prototype`, [
      ...workspaceApi([repository], {
        role: "MEMBER",
        respondToWorkspace(_request, workspace) {
          workspaceReads()
          return HttpResponse.json({ ...workspace, repositories })
        },
      }),
      galleryApi(repository, (request) => galleryReads(new URL(request.url).searchParams.get("q"))),
    ])

    const picker = await selectedRepository(repository.nameWithOwner)
    fireEvent.click(picker)
    expect(screen.getByRole("link", { name: removedRepository.nameWithOwner })).toBeVisible()
    fireEvent.click(picker)

    repositories = [repository]
    fireEvent.click(screen.getByRole("link", { name: "Prototypes" }))
    await waitFor(() => expect(router.state.location.search).toBe(""))
    expect(galleryReads.mock.calls).toEqual([["prototype"], [null]])
    fireEvent.click(await selectedRepository(repository.nameWithOwner))
    expect(screen.getByRole("link", { name: repository.nameWithOwner })).toBeVisible()
    expect(
      screen.queryByRole("link", { name: removedRepository.nameWithOwner }),
    ).not.toBeInTheDocument()
    fireEvent.click(await selectedRepository(repository.nameWithOwner))
    expect(workspaceReads).toHaveBeenCalledTimes(2)

    const locationKey = router.state.location.key
    expect(fireEvent.click(screen.getByRole("link", { name: "Prototypes" }))).toBe(false)
    expect(router.state.location.key).toBe(locationKey)
    expect(router.state.navigation.state).toBe("idle")
    expect(galleryReads).toHaveBeenCalledTimes(2)
    expect(workspaceReads).toHaveBeenCalledTimes(2)

    await act(() => router.revalidate())
    expect(galleryReads).toHaveBeenCalledTimes(3)
    expect(workspaceReads).toHaveBeenCalledTimes(3)
  })

  it("stays on Prototypes when its active link is clicked while Create is loading", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const path = `/repositories/${repository.id}`
    const create = deferResponse()
    const templateRead = vi.fn()
    const router = await renderApplication(path, [
      ...workspaceApi([repository], { role: "MEMBER" }),
      galleryApi(repository),
      http.get(`${window.location.origin}/api${path}/templates`, async () => {
        templateRead()
        await create.pending
        return HttpResponse.json({ repository, templates: [], canCreate: true })
      }),
    ])

    fireEvent.click(screen.getByRole("link", { name: "Create" }))
    await waitFor(() => expect(templateRead).toHaveBeenCalledOnce())
    expect(router.state.navigation.location?.pathname).toBe(`${path}/new`)

    fireEvent.click(screen.getByRole("link", { name: "Prototypes", current: "page" }))
    await waitFor(() => expect(router.state.navigation.state).toBe("idle"))
    await act(() => {
      create.release()
      return create.pending
    })

    expect(router.state.location.pathname).toBe(path)
    expect(screen.getByRole("heading", { name: "Prototypes" })).toBeVisible()
  })

  it("drops Hub administrator links on a same-repository transition after a role change", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
    }
    let administerHub = true
    await renderApplication(`/welcome?repositoryId=${repository.id}`, [
      ...workspaceApi([repository], {
        respondToWorkspace(_request, workspace) {
          return HttpResponse.json({
            ...workspace,
            capabilities: { ...workspace.capabilities, administerHub },
          })
        },
      }),
      galleryApi(repository),
    ])
    expect(screen.getByRole("link", { name: "Hub administrators" })).toBeVisible()

    administerHub = false
    fireEvent.click(screen.getByRole("link", { name: "Prototypes" }))

    expect(await screen.findByRole("heading", { name: "Prototypes" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Account menu for @octocat" })).toBeVisible()
    expect(screen.queryByRole("link", { name: "Hub administrators" })).not.toBeInTheDocument()
  })

  it.each(["an unavailable result", "a failed request"] as const)(
    "can retry a background permission check after %s",
    async (failure) => {
      const repository = {
        id: "11111111-1111-4111-8111-111111111111",
        nameWithOwner: "team/alpha",
        defaultBranch: "main",
        capabilities: { reviewPrototypes: true, manageSharing: false },
      }
      const permissionReads = vi.fn()
      await renderApplication(`/repositories/${repository.id}`, [
        ...workspaceApi([repository], {
          role: "MEMBER",
          respondToWorkspace(request, workspace) {
            if (new URL(request.url).searchParams.get("view") === "navigation") {
              return HttpResponse.json({ ...workspace, repositoryPermissionsAvailable: true })
            }
            permissionReads()
            const firstCheck = permissionReads.mock.calls.length === 1
            if (firstCheck && failure === "a failed request") return HttpResponse.error()
            return HttpResponse.json({
              ...workspace,
              repositories: [
                {
                  ...repository,
                  capabilities: {
                    ...repository.capabilities,
                    repositoryPermissionUnavailable: firstCheck,
                    administerRepository: !firstCheck,
                  },
                },
              ],
            })
          },
        }),
        galleryApi(repository),
      ])

      const retry = await screen.findByRole("button", { name: "Retry permission check" })
      expect(screen.getByRole("heading", { name: "Prototypes" })).toBeVisible()
      expect(screen.queryByRole("link", { name: "Security audit" })).not.toBeInTheDocument()
      expect(permissionReads).toHaveBeenCalledOnce()

      fireEvent.click(retry)

      expect(await screen.findByRole("link", { name: "Security audit" })).toHaveAttribute(
        "href",
        `/settings/audit?scope=repository&repositoryId=${repository.id}`,
      )
      expect(
        screen.queryByRole("button", { name: "Retry permission check" }),
      ).not.toBeInTheDocument()
      expect(permissionReads).toHaveBeenCalledTimes(2)
    },
  )

  it("returns to sign-in without private navigation when a background permission check expires", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
    }
    const permission = deferResponse()
    function expired() {
      return HttpResponse.json({ error: "Sign in to continue." }, { status: 401 })
    }
    let signedOut = false
    await renderApplication(`/repositories/${repository.id}`, [
      json("/api/auth/providers", { providers: ["github"] }),
      http.get(`${window.location.origin}/api/auth/session`, () =>
        signedOut ? expired() : undefined,
      ),
      ...workspaceApi([repository], {
        async respondToWorkspace(request, workspace) {
          if (new URL(request.url).searchParams.get("view") === "navigation") {
            return signedOut
              ? expired()
              : HttpResponse.json({ ...workspace, repositoryPermissionsAvailable: true })
          }
          await permission.pending
          signedOut = true
          return expired()
        },
      }),
      galleryApi(repository),
    ])
    expect(await selectedRepository(repository.nameWithOwner)).toBeVisible()

    await act(() => {
      permission.release()
      return permission.pending
    })

    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Account menu for @octocat" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Prototypes" })).not.toBeInTheDocument()
  })

  it.each(["viewer", "Hub role", "selected repository"] as const)(
    "reads authoritative navigation when the permission result disagrees about the %s",
    async (changed) => {
      const repository = {
        id: "11111111-1111-4111-8111-111111111111",
        nameWithOwner: "team/alpha",
        defaultBranch: "main",
        capabilities: { reviewPrototypes: true, manageSharing: false },
      }
      const next = {
        ...repository,
        id: "22222222-2222-4222-8222-222222222222",
        nameWithOwner: "team/beta",
      }
      const navigationReads = vi.fn()
      let checkedPermissions = false
      await renderApplication(`/welcome?repositoryId=${repository.id}`, [
        ...workspaceApi([repository], {
          respondToWorkspace(request, workspace) {
            const change = {
              ...workspace,
              viewer:
                changed === "viewer"
                  ? {
                      ...workspace.viewer,
                      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                      login: "mona",
                    }
                  : workspace.viewer,
              capabilities: {
                ...workspace.capabilities,
                administerHub: changed !== "Hub role",
              },
            }
            if (new URL(request.url).searchParams.get("view") === "navigation") {
              navigationReads()
              return HttpResponse.json(
                checkedPermissions
                  ? { ...change, repositories: [next] }
                  : { ...workspace, repositoryPermissionsAvailable: true },
              )
            }
            checkedPermissions = true
            return HttpResponse.json({
              ...change,
              repositories: changed === "selected repository" ? [] : workspace.repositories,
            })
          },
        }),
      ])

      expect(await selectedRepository(next.nameWithOwner)).toBeVisible()
      expect(navigationReads).toHaveBeenCalledTimes(2)
    },
  )

  it("keeps one collapsed navigation across signed-in pages and a page error", async () => {
    const first = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const selected = {
      ...first,
      id: "22222222-2222-4222-8222-222222222222",
      nameWithOwner: "team/beta",
    }
    const galleryPath = `/repositories/${selected.id}`
    const templatePath = `${galleryPath}/templates/default`
    const prototypeId = "33333333-3333-4333-8333-333333333333"
    const prototypePath = `${galleryPath}/prototypes/${prototypeId}`
    const notification = unreadMention(selected, prototypeId)
    const realtime = new URL("/api/realtime", window.location.href)
    realtime.protocol = realtime.protocol === "https:" ? "wss:" : "ws:"
    const permission = deferResponse()
    const selectedPermissionReads = vi.fn()
    const auditScopes: string[] = []
    function audit(scope: string) {
      auditScopes.push(scope)
      return HttpResponse.json({
        records: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            occurredAt: "2026-11-20T12:00:00.000Z",
            action: `${scope}.setting.changed`,
            outcome: null,
            actor: null,
            context: {},
          },
        ],
        nextCursor: null,
      })
    }

    const router = await renderApplication("/repositories", [
      ws.link(realtime.href).addEventListener("connection", () => undefined),
      ...workspaceApi([first, selected], {
        reviewInboxAvailable: true,
        async respondToWorkspace(request, workspace) {
          const query = new URL(request.url).searchParams
          if (query.get("view") === "navigation") {
            return HttpResponse.json({ ...workspace, repositoryPermissionsAvailable: true })
          }
          if (query.get("repositoryId") !== selected.id) return HttpResponse.json(workspace)
          selectedPermissionReads()
          await permission.pending
          return HttpResponse.json({
            ...workspace,
            repositories: workspace.repositories.map((repository) =>
              repository.id === selected.id
                ? {
                    ...repository,
                    capabilities: {
                      ...repository.capabilities,
                      administerRepository: true,
                      manageAnalytics: true,
                    },
                  }
                : repository,
            ),
          })
        },
      }),
      galleryApi(first),
      galleryApi(selected),
      json(`/api${templatePath}`, {
        repository: selected,
        template: {
          id: "default",
          name: "Default",
          description: "Start from a blank prototype.",
          route: "/",
          previewUrl: null,
          screenshotUrl: null,
          buildNumber: null,
        },
        canCreate: true,
      }),
      json(`/api${prototypePath}`, {
        repository: selected,
        prototype: {
          id: prototypeId,
          repositoryId: selected.id,
          name: "Landing page",
          branchName: "prototype/landing-page",
          description: null,
          authorLogin: "mona",
          canEdit: false,
          builds: [],
        },
        selectedBuild: null,
        showPrototypeInfo: false,
      }),
      json(`/api${prototypePath}/review-comments`, {
        comments: [],
        nextCursor: null,
        hasMore: false,
      }),
      json("/api/session-revocation", {
        status: {
          activeSessionCount: 3,
          pendingAuthenticationCount: 0,
          pendingSensitiveAuthorizationCount: 0,
          revision: 1,
        },
      }),
      json("/api/administrators", { administrators: [], nextCursor: null }),
      json("/api/copilot-connection", {
        configured: true,
        connected: false,
        savedConnection: false,
        connectedBy: null,
        refusedAt: null,
        verifiedAt: null,
      }),
      http.get(`${window.location.origin}/api/security-audits`, () => audit("hub")),
      http.get(`${window.location.origin}/api${galleryPath}/security-audit`, () =>
        audit("repository"),
      ),
      http.get(`${window.location.origin}/api/notifications/inbox`, ({ request }) => {
        const countOnly = new URL(request.url).searchParams.get("limit") === "1"
        return HttpResponse.json({
          notifications: [notification],
          nextBefore: countOnly ? notification.id : null,
          unreadCount: countOnly ? 3 : 1,
        })
      }),
      json("/api/canvas/connections", { connections: [] }),
      http.get(`${window.location.origin}/api${galleryPath}/analytics`, () =>
        HttpResponse.json({ error: "Repository analytics is unavailable." }, { status: 403 }),
      ),
    ])

    fireEvent.click(await selectedRepository(first.nameWithOwner))
    fireEvent.click(await screen.findByRole("link", { name: selected.nameWithOwner }))
    const pickerName = `Choose repository. ${selected.nameWithOwner} selected`
    expect(await selectedRepository(selected.nameWithOwner)).toBeVisible()
    await waitFor(() => expect(selectedPermissionReads).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))
    const navigation = screen.getByRole("navigation", { name: "Repository navigation" })
    const galleryDestinations = sidebarDestinations()

    function expectRetainedNavigation(destination: string) {
      expect
        .soft(
          {
            sameNavigation: screen
              .queryAllByRole("navigation", { name: /^(Repository|Hub) navigation$/ })
              .map((current) => current === navigation),
            collapsed:
              screen.queryByRole("button", { name: "Expand sidebar", expanded: false }) !== null,
            selectedRepository: screen.queryByRole("button", { name: pickerName }) !== null,
            unreadCount: screen.queryByRole("link", { name: "Inbox, 1 unread" }) !== null,
          },
          `Retained navigation on ${destination}`,
        )
        .toEqual({
          sameNavigation: [true],
          collapsed: true,
          selectedRepository: true,
          unreadCount: true,
        })
    }

    for (const [label, pathname, heading] of [
      [/^Inbox\b/, "/notifications", "Inbox"],
      ["Welcome", "/welcome", "Getting started with Replica"],
      ["End all Hub sessions", "/settings/sessions", "End all Hub sessions"],
      ["Hub administrators", "/settings/administrators", "Hub administrators"],
      ["Copilot connection", "/settings/copilot", "Copilot"],
      ["Security audit", "/settings/audit", "Security audit"],
    ] as const) {
      const link = screen.getByRole<HTMLAnchorElement>("link", { name: label })
      const target = new URL(link.href)
      expect(target.pathname).toBe(pathname)
      expect(target.searchParams.get("repositoryId")).toBe(selected.id)
      if (pathname === "/settings/audit") expect(target.searchParams.get("scope")).toBe("hub")

      fireEvent.click(link)
      expect(await screen.findByRole("heading", { name: heading })).toBeVisible()
      if (pathname === "/notifications") {
        expect(await screen.findByRole("link", { name: "Inbox, 1 unread" })).toBeVisible()
      }
      expect(router.state.location.pathname + router.state.location.search).toBe(
        target.pathname + target.search,
      )
      expectRetainedNavigation(pathname)
      expect(sidebarDestinations()).toEqual(galleryDestinations)
    }
    expect(await screen.findByText("hub.setting.changed")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Audit scope" }))
    expect(screen.getByRole("menuitem", { name: "Hub" })).toHaveAttribute("aria-current", "page")
    expect(screen.queryByRole("menuitem", { name: selected.nameWithOwner })).not.toBeInTheDocument()

    await act(() => {
      permission.release()
      return permission.pending
    })
    expect(await screen.findByRole("link", { name: "Analytics" })).toBeVisible()
    expect
      .soft(screen.getByRole("link", { name: "Security audit" }))
      .toHaveAttribute("href", `/settings/audit?scope=hub&repositoryId=${selected.id}`)
    const repositoryScope = await screen.findByRole("menuitem", { name: selected.nameWithOwner })
    fireEvent.click(within(repositoryScope).getByRole("link", { name: selected.nameWithOwner }))
    expect(await screen.findByText("repository.setting.changed")).toBeVisible()
    expect(auditScopes).toEqual(["hub", "repository"])
    expectRetainedNavigation("repository audit")

    fireEvent.click(screen.getByRole("link", { name: "Canvas connections" }))
    expect(await screen.findByRole("heading", { name: "Canvas connections" })).toBeVisible()
    expect(router.state.location.pathname + router.state.location.search).toBe(
      `/canvas/connections?repositoryId=${selected.id}`,
    )
    expectRetainedNavigation("Canvas connections")

    await act(() => router.navigate(templatePath))
    expect(await screen.findByRole("heading", { name: "Default" })).toBeVisible()
    expectRetainedNavigation("template browsing")

    await act(() => router.navigate(prototypePath))
    expect(await screen.findByRole("heading", { name: "Landing page" })).toBeVisible()
    expectRetainedNavigation("prototype review")

    await act(() => router.navigate(`${galleryPath}/analytics`))
    expect(await screen.findByText("Repository analytics is unavailable.")).toBeVisible()
    expectRetainedNavigation("a failed repository tool")
    expect(selectedPermissionReads).toHaveBeenCalledOnce()

    await act(() => router.navigate("/settings/copilot"))
    expect(await selectedRepository(first.nameWithOwner)).toBeVisible()
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
      "href",
      `/repositories/${first.id}`,
    )
  }, 15_000)

  it.each([
    ["no readable repository", "No repository selected", false],
    ["repository navigation unavailable", "Repository navigation unavailable", true],
  ] as const)(
    "opens Hub administrators with %s without a full workspace read",
    async (_state, picker, unavailable) => {
      const workspaceViews: (string | null)[] = []
      await renderApplication("/settings/administrators", [
        ...workspaceApi([], {
          respondToWorkspace(request, workspace) {
            const view = new URL(request.url).searchParams.get("view")
            workspaceViews.push(view)
            if (unavailable) {
              return HttpResponse.json({ error: "Repository navigation failed." }, { status: 503 })
            }
            return HttpResponse.json({ ...workspace, repositoryPermissionsAvailable: true })
          },
        }),
        json("/api/administrators", { administrators: [], nextCursor: null }),
      ])

      expect(await screen.findByRole("heading", { name: "Hub administrators" })).toBeVisible()
      expect(screen.getByRole("button", { name: picker })).toBeDisabled()
      expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
        "href",
        "/repositories",
      )
      expect(workspaceViews).toEqual(["navigation"])
    },
  )

  it("resets the collapsed nav and private Inbox badge on navigation after an account change", async () => {
    const repository = {
      id: "11111111-1111-4111-8111-111111111111",
      nameWithOwner: "team/alpha",
      defaultBranch: "main",
      capabilities: { reviewPrototypes: true, manageSharing: false, browseTemplates: true },
    }
    const galleryPath = `/repositories/${repository.id}`
    let changedViewer = false
    await renderApplication(galleryPath, [
      ...workspaceApi([repository], {
        reviewInboxAvailable: true,
        respondToWorkspace(_request, workspace) {
          return HttpResponse.json(
            changedViewer
              ? {
                  ...workspace,
                  viewer: {
                    ...workspace.viewer,
                    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                    login: "mona",
                  },
                }
              : workspace,
          )
        },
      }),
      galleryApi(repository),
      json(`/api${galleryPath}/templates`, { repository, templates: [], canCreate: true }),
      http.get(`${window.location.origin}/api/notifications/inbox`, () =>
        HttpResponse.json({
          notifications: [],
          nextBefore: null,
          unreadCount: changedViewer ? 0 : 5,
        }),
      ),
    ])
    await screen.findByRole("link", { name: "Inbox, 5 unread" })
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }))

    changedViewer = true
    fireEvent.click(screen.getByRole("link", { name: "Create" }))

    expect(await screen.findByRole("heading", { name: "What should we create?" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Account menu for @mona" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeVisible()
    expect(screen.queryByRole("link", { name: "Inbox, 5 unread" })).not.toBeInTheDocument()
  })

  it("keeps the Canvas connections return destination on a signed-out deep link", async () => {
    const path = "/canvas/connections?repositoryId=22222222-2222-4222-8222-222222222222"
    const router = await renderApplication(path, [
      json("/api/auth/providers", { providers: ["github"] }),
      ...["/api/auth/session", "/api/canvas/connections", "/api/workspace"].map((endpoint) =>
        http.get(`${window.location.origin}${endpoint}`, () =>
          HttpResponse.json({ error: "Sign in to continue." }, { status: 401 }),
        ),
      ),
    ])

    const signIn = await screen.findByRole<HTMLButtonElement>("button", {
      name: "Sign in with GitHub",
    })
    expect(signIn.form).toHaveAttribute("action", "/api/auth/github/start")
    expect(new FormData(signIn.form ?? undefined).get("return_to")).toBe("/canvas/connections")
    expect(router.state.location.pathname + router.state.location.search).toBe(path)
    expect(screen.queryByRole("link", { name: "Prototypes" })).not.toBeInTheDocument()
  })

  it("shows a disabled picker and Prototypes without Create on a repository-free landing", async () => {
    await renderApplication("/repositories", workspaceApi([]))

    expect(await screen.findByRole("heading", { name: "No repositories available" })).toBeVisible()
    const picker = screen.getByRole("button", { name: "No repository selected" })
    expect(picker).toBeVisible()
    expect(picker.matches(':disabled, [aria-disabled="true"]')).toBe(true)
    expect(screen.getByRole("link", { name: "Prototypes" })).toBeVisible()
    expect(screen.queryByRole("link", { name: "Repositories" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument()
  })

  it("shows the default Welcome video and opens Create for an eligible local repository", async () => {
    vi.stubEnv("VITE_WELCOME_VIDEO_URL", "")
    vi.stubEnv("VITE_WELCOME_VIDEO_POSTER_URL", "")
    const repository = {
      id: "33333333-3333-4333-8333-333333333333",
      nameWithOwner: "local/prototype",
      defaultBranch: "main",
      capabilities: {
        reviewPrototypes: true,
        manageSharing: false,
        browseTemplates: true,
        local: true,
      },
    }
    const createPath = `/repositories/${repository.id}/new`
    const router = await renderApplication("/welcome", [
      ...workspaceApi([repository], { provider: "local" }),
      json(`/api/repositories/${repository.id}/templates`, {
        repository,
        templates: [
          {
            id: "default",
            name: "Default",
            description: "Start from a blank prototype.",
            route: "/",
            previewUrl: null,
            screenshotUrl: null,
            buildNumber: null,
          },
        ],
        canCreate: true,
        submissionMode: "copy",
      }),
    ])

    expect(screen.getByLabelText("Learn how Replica works")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/J2Z28CwIfsA",
    )
    expect(screen.getByRole("link", { name: "Watch on YouTube" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=J2Z28CwIfsA",
    )
    fireEvent.click(screen.getByRole("link", { name: "Create prototype" }))
    expect(await screen.findByRole("heading", { name: "What should we create?" })).toBeVisible()
    expect(router.state.location.pathname).toBe(createPath)
  })
})
