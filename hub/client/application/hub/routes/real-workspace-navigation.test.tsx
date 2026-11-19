import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { http, HttpResponse, type HttpHandler, type JsonBodyType } from "msw"
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

import type { RepositoryRecord } from "@application/hub/contracts/types"
import { HubThemeProvider } from "@hooks/use-hub-theme"

import routes from "../routes"

type RouteModule = {
  default: ComponentType<{ loaderData: unknown }>
  clientLoader?: (args: LoaderFunctionArgs & { serverLoader: () => Promise<never> }) => unknown
  shouldRevalidate?: ShouldRevalidateFunction
  ErrorBoundary?: ComponentType
  HydrateFallback?: ComponentType
}

const routeModules = import.meta.glob<RouteModule>(
  [
    "../root.tsx",
    "./{home,workspace,repositories,repository,product-new,settings-administrators,settings-audit,settings-copilot,settings-notifications,settings-sessions,settings-welcome}/index.tsx",
  ],
  { eager: true },
)

function applicationRoutes(entries: RouteConfigEntry[]): RouteObject[] {
  return entries.flatMap((entry): RouteObject[] => {
    const path =
      entry.file === "root.tsx" ? "../root.tsx" : `./${entry.file.replace(/^routes\//, "")}`
    const module = routeModules[path]
    const children = applicationRoutes(entry.children ?? [])
    if (!module) {
      if (children.length) throw new Error(`Missing layout for workspace routes: ${entry.file}`)
      return []
    }

    const { default: Page, clientLoader, shouldRevalidate, ErrorBoundary, HydrateFallback } = module
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
      Component: () => <Page loaderData={useLoaderData()} />,
      ErrorBoundary,
      HydrateFallback,
    }
    return entry.index ? [{ ...common, index: true }] : [{ ...common, children }]
  })
}

async function renderApplication(path: string, handlers: Parameters<typeof setupServer>) {
  vi.stubEnv("MODE", "development")
  vi.stubEnv("DEV", true)
  const server = setupServer(...handlers)
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
  window.history.replaceState(null, "", path)
  const router = createBrowserRouter(
    applicationRoutes([{ id: "root", file: "root.tsx", children: routes }]),
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
    reviewInboxAvailable = false,
  }: {
    provider?: "github" | "local"
    reviewInboxAvailable?: boolean
  } = {},
) {
  const user = {
    provider,
    login: provider === "local" ? "local-developer" : "octocat",
    name: provider === "local" ? "Local developer" : "The Octocat",
  }
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  return [
    json("/api/auth/session", {
      authenticated: true,
      membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      userId,
      ...user,
      role: "ADMINISTRATOR",
      reviewInboxAvailable,
    }),
    json("/api/workspace", {
      viewer: { id: userId, ...user, avatarUrl: null },
      capabilities: {
        createPrototypes: false,
        reviewPrototypes: false,
        manageSharing: false,
        administerHub: true,
      },
      repositories,
      reviewInboxAvailable,
      welcomeHidden: false,
    }),
  ]
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
  it("keeps the selected repository's sidebar when following Hub links and uses the first repository for a bare URL", async () => {
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
    const router = await renderApplication("/repositories", [
      ...workspaceApi([first, selected], { reviewInboxAvailable: true }),
      ...[first, selected].map((repository) =>
        json(`/api/repositories/${repository.id}`, {
          repository,
          prototypes: [],
          authors: [],
          pagination: { page: 1, pageSize: 24, pageCount: 1, totalCount: 0 },
        }),
      ),
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
      json("/api/security-audits", { records: [], nextCursor: null }),
      json("/api/notifications/inbox", { notifications: [], nextBefore: null, unreadCount: 0 }),
    ])

    fireEvent.click(await selectedRepository(first.nameWithOwner))
    fireEvent.click(await screen.findByRole("link", { name: selected.nameWithOwner }))
    expect(await selectedRepository(selected.nameWithOwner)).toBeVisible()
    const galleryPath = `/repositories/${selected.id}`
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute("href", galleryPath)
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute(
      "href",
      `${galleryPath}/new`,
    )
    const galleryDestinations = sidebarDestinations()

    for (const [label, pathname, heading] of [
      ["End all Hub sessions", "/settings/sessions", "End all Hub sessions"],
      ["Hub administrators", "/settings/administrators", "Hub administrators"],
      ["Copilot connection", "/settings/copilot", "Copilot"],
      ["Security audit", "/settings/audit", "Security audit"],
      ["Inbox", "/notifications", "Inbox"],
    ]) {
      const link = screen.getByRole<HTMLAnchorElement>("link", { name: label })
      const target = new URL(link.href)
      expect(target.pathname).toBe(pathname)
      expect(target.searchParams.get("repositoryId")).toBe(selected.id)
      if (pathname === "/settings/audit") expect(target.searchParams.get("scope")).toBe("hub")

      fireEvent.click(link)
      expect(await screen.findByRole("heading", { name: heading })).toBeVisible()
      expect(router.state.location.pathname).toBe(pathname)
      expect(await selectedRepository(selected.nameWithOwner)).toBeVisible()
      expect(sidebarDestinations()).toEqual(galleryDestinations)
    }

    await act(async () => {
      await router.navigate("/settings/copilot")
      await router.navigate("/notifications")
    })
    expect(await selectedRepository(first.nameWithOwner)).toBeVisible()
    expect(screen.getByRole("link", { name: "Prototypes" })).toHaveAttribute(
      "href",
      `/repositories/${first.id}`,
    )
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
