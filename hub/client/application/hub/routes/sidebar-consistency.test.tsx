import { fireEvent, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { settingsQuerySchema } from "../settings-contracts"
import ProductNewRoute, { clientLoader as loadCatalog } from "./product-new"
import ProductSharingSettingsRoute, {
  clientLoader as loadSharing,
} from "./product-sharing-settings"
import SettingsAnalyticsRoute, { clientLoader as loadAnalytics } from "./settings-analytics"
import SettingsCopilotRoute, { clientLoader as loadCopilot } from "./settings-copilot"
import SettingsLearningsRoute, { clientLoader as loadLearnings } from "./settings-learnings"
import SettingsNotificationsRoute, {
  clientLoader as loadNotifications,
} from "./settings-notifications"
import SettingsWelcomeRoute, { clientLoader as loadWelcome } from "./settings-welcome"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function ProductNewComponent() {
  return <ProductNewRoute loaderData={useLoaderData<typeof loadCatalog>()} />
}

function SharingComponent() {
  return <ProductSharingSettingsRoute loaderData={useLoaderData<typeof loadSharing>()} />
}

function AnalyticsComponent() {
  return <SettingsAnalyticsRoute loaderData={useLoaderData<typeof loadAnalytics>()} />
}

function CopilotComponent() {
  return <SettingsCopilotRoute loaderData={useLoaderData<typeof loadCopilot>()} />
}

function LearningsComponent() {
  return <SettingsLearningsRoute loaderData={useLoaderData<typeof loadLearnings>()} />
}

function NotificationsComponent() {
  return <SettingsNotificationsRoute loaderData={useLoaderData<typeof loadNotifications>()} />
}

function WelcomeComponent() {
  return <SettingsWelcomeRoute loaderData={useLoaderData<typeof loadWelcome>()} />
}

function unavailableServerRoute(): Promise<never> {
  return Promise.reject(new Error("The mock frontend must not call a server route."))
}

const workspaceRoutes: RouteObject[] = [
  {
    path: "/repositories/:repositoryId/new",
    loader: loadCatalog,
    Component: ProductNewComponent,
  },
  {
    path: "/repositories/:repositoryId/analytics",
    loader: (args) => loadAnalytics({ ...args, serverLoader: unavailableServerRoute }),
    Component: AnalyticsComponent,
  },
  {
    path: "/repositories/:repositoryId/learnings",
    loader: (args) => loadLearnings({ ...args, serverLoader: unavailableServerRoute }),
    Component: LearningsComponent,
  },
  {
    path: "/settings/copilot",
    loader: (args) => loadCopilot({ ...args, serverLoader: unavailableServerRoute }),
    Component: CopilotComponent,
  },
  {
    path: "/settings/sharing",
    loader: loadSharing,
    Component: SharingComponent,
  },
  {
    path: "/notifications",
    loader: (args) => loadNotifications({ ...args, serverLoader: unavailableServerRoute }),
    Component: NotificationsComponent,
  },
  {
    path: "/welcome",
    loader: (args) => loadWelcome({ ...args, serverLoader: unavailableServerRoute }),
    Component: WelcomeComponent,
  },
]

function navigationLinks() {
  return screen
    .getAllByRole("navigation")
    .flatMap((navigation) => within(navigation).getAllByRole<HTMLAnchorElement>("link"))
}

function linkTarget(link: HTMLAnchorElement) {
  const url = new URL(link.href)
  url.searchParams.sort()
  return url.pathname + url.search
}

function expectedAdministration(repositoryId?: number) {
  const search = repositoryId ? `?repositoryId=${repositoryId}` : ""
  return [
    ["Hub administrators", `/settings/admins${search}`],
    ["Public sharing", `/settings/sharing${search}`],
    ["End all Hub sessions", `/settings/sessions${search}`],
    ["GitHub App", `/settings/github${search}`],
    ["Copilot connection", `/settings/copilot${search}`],
    [
      "Security audit",
      repositoryId
        ? `/settings/audit?repositoryId=${repositoryId}&scope=hub`
        : "/settings/audit?scope=hub",
    ],
  ]
}

function administrationLinks() {
  const navigation = screen.queryByRole("navigation", { name: "Security and settings" })
  return navigation
    ? within(navigation)
        .queryAllByRole<HTMLAnchorElement>("link")
        .map((link) => [link.textContent?.trim(), linkTarget(link)])
    : []
}

function expectRepositoryNavigation({
  admin,
  canCreate = true,
  welcomeHidden = false,
  unreadCount,
}: {
  admin: boolean
  canCreate?: boolean
  welcomeHidden?: boolean
  unreadCount: number
}) {
  const lowerMenu = admin
    ? expectedAdministration(2002)
    : [["Security audit", "/settings/audit?repositoryId=2002&scope=repository"]]
  expect(administrationLinks()).toEqual(lowerMenu)
  const links = navigationLinks()
  expect(links.map(linkTarget)).toEqual([
    ...(welcomeHidden ? [] : ["/welcome?repositoryId=2002"]),
    ...(canCreate ? ["/repositories/2002/new"] : []),
    "/repositories/2002",
    "/notifications?repositoryId=2002",
    "/repositories/2002/analytics",
    "/repositories/2002/learnings",
    ...lowerMenu.map(([, path]) => path),
  ])
  expect(
    screen.getByRole("button", { name: "Choose repository. github/empty selected" }),
  ).toBeVisible()
  const notifications = links.find((link) => new URL(link.href).pathname === "/notifications")!
  expect(notifications).toHaveAccessibleName(/notifications/i)
  if (unreadCount > 0) {
    expect(within(notifications).getByText(String(unreadCount))).toBeVisible()
  } else {
    expect(notifications).toHaveAccessibleName("Notifications")
  }
}

describe("Hub sidebar consistency", () => {
  it("keeps the same ordered administrator menu and repository targets through repository, Create and settings pages", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const unreadCount = store.getWorkspace().navigation!.notificationsUnreadCount
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2002", { workspaceRoutes })
    expectRepositoryNavigation({ admin: true, unreadCount })

    for (const pathname of [
      "/repositories/2002/new",
      "/welcome",
      "/repositories/2002/analytics",
      "/repositories/2002/learnings",
      "/notifications",
      "/settings/copilot",
      "/settings/sharing",
      "/repositories/2002",
    ]) {
      const link = navigationLinks().find((item) => new URL(item.href).pathname === pathname)!
      await router.settle(() => fireEvent.click(link))
      expect(router.state.location.pathname).toBe(pathname)
      expectRepositoryNavigation({ admin: true, unreadCount })
    }
  })

  it.each([
    { profile: "owner", canCreate: true },
    { profile: "reader", canCreate: false },
  ] as const)(
    "keeps $profile permissions, hidden Welcome and unread counts when moving between repository and settings pages",
    async ({ profile, canCreate }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select(profile)
      store.settings.mutate({ operation: "welcome-hide" })
      const unreadCount = store.getWorkspace().navigation!.notificationsUnreadCount
      const server = setupServer(...createMockHandlers(store))
      const router = await renderHubFlow(server, "/repositories/2002", { workspaceRoutes })
      expectRepositoryNavigation({ admin: false, canCreate, welcomeHidden: true, unreadCount })

      for (const pathname of [
        "/repositories/2002/analytics",
        "/repositories/2002/learnings",
        "/notifications",
        "/repositories/2002",
      ]) {
        const link = navigationLinks().find((item) => new URL(item.href).pathname === pathname)!
        await router.settle(() => fireEvent.click(link))
        expect(router.state.location.pathname).toBe(pathname)
        expectRepositoryNavigation({ admin: false, canCreate, welcomeHidden: true, unreadCount })
      }
    },
  )

  it("honors current repository-settings permission denial over stale administrator workspace capabilities", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const unreadCount = store.getWorkspace().navigation!.notificationsUnreadCount
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/settings/workspace`, ({ request }) => {
        const query = settingsQuerySchema.parse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        const state = store.settings.getWorkspace(query)
        return HttpResponse.json({
          ...state,
          session: {
            ...state.session,
            capabilities: { ...state.session.capabilities, administerHub: false },
          },
        })
      }),
    )
    const router = await renderHubFlow(server, "/repositories/2002/analytics", {
      workspaceRoutes,
    })

    expectRepositoryNavigation({ admin: false, unreadCount })
    await router.settle(() =>
      fireEvent.click(
        navigationLinks().find(
          (link) => new URL(link.href).pathname === "/repositories/2002/learnings",
        )!,
      ),
    )
    expectRepositoryNavigation({ admin: false, unreadCount })
  })

  it.each([
    { profile: "admin", admin: true },
    { profile: "owner", admin: false },
  ] as const)(
    "keeps only available global navigation for $profile when no repository is accessible",
    async ({ profile, admin }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select(profile)
      const server = setupServer(...createMockHandlers(store))
      server.use(
        http.get(`${store.origin}/api/workspace`, () =>
          HttpResponse.json({ ...store.getWorkspace(), repositories: [] }),
        ),
        http.get(`${store.origin}/api/settings/workspace`, ({ request }) =>
          HttpResponse.json({
            ...store.settings.getWorkspace(
              settingsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams)),
            ),
            repository: null,
            analytics: [],
            learnings: [],
            learningRuns: [],
          }),
        ),
      )
      const router = await renderHubFlow(server, "/welcome", { workspaceRoutes })

      for (const pathname of ["/welcome", "/notifications", "/settings/copilot"]) {
        if (router.state.location.pathname !== pathname) {
          await router.settle(() => router.navigate(pathname))
        }
        const lowerMenu = admin ? expectedAdministration() : []
        expect(administrationLinks()).toEqual(lowerMenu)
        expect(navigationLinks().map(linkTarget)).toEqual([
          "/welcome",
          "/repositories",
          "/notifications",
          ...lowerMenu.map(([, path]) => path),
        ])
        expect(
          screen.queryByRole("button", { name: /^Choose repository\./ }),
        ).not.toBeInTheDocument()
      }
    },
  )
})
