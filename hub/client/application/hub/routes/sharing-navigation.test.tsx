import { fireEvent, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import ProductSharingSettingsRoute, {
  clientLoader as loadSharingSettings,
} from "./product-sharing-settings"
import SettingsCopilotRoute, { clientLoader as loadCopilot } from "./settings-copilot"
import SettingsNotificationsRoute, {
  clientLoader as loadNotifications,
} from "./settings-notifications"
import { renderHubFlow } from "./test-fixture"

function SharingSettingsComponent() {
  return <ProductSharingSettingsRoute loaderData={useLoaderData<typeof loadSharingSettings>()} />
}

function CopilotComponent() {
  return <SettingsCopilotRoute loaderData={useLoaderData<typeof loadCopilot>()} />
}

function NotificationsComponent() {
  return <SettingsNotificationsRoute loaderData={useLoaderData<typeof loadNotifications>()} />
}

function unavailableServerRoute(): Promise<never> {
  return Promise.reject(new Error("The mock frontend must not call a server route."))
}

const workspaceRoutes: RouteObject[] = [
  {
    path: "/settings/sharing",
    loader: loadSharingSettings,
    Component: SharingSettingsComponent,
  },
  {
    path: "/settings/copilot",
    loader: (args) => loadCopilot({ ...args, serverLoader: unavailableServerRoute }),
    Component: CopilotComponent,
  },
  {
    path: "/notifications",
    loader: (args) => loadNotifications({ ...args, serverLoader: unavailableServerRoute }),
    Component: NotificationsComponent,
  },
]

function navigationLink(pathname: string) {
  const link = screen
    .getAllByRole("navigation")
    .flatMap((navigation) => within(navigation).queryAllByRole<HTMLAnchorElement>("link"))
    .find((item) => new URL(item.href).pathname === pathname)
  if (!link) throw new Error(`The sidebar must offer ${pathname}.`)
  return link
}

function expectRepository(repositoryId: number, nameWithOwner: string) {
  expect(
    screen.getByRole("button", { name: `Choose repository. ${nameWithOwner} selected` }),
  ).toHaveTextContent(nameWithOwner)
  expect(navigationLink(`/repositories/${repositoryId}`)).toHaveAccessibleName("Prototypes")
  for (const section of ["analytics", "learnings"]) {
    expect(navigationLink(`/repositories/${repositoryId}/${section}`)).toHaveAccessibleName(
      section === "analytics" ? "Analytics" : "Learnings",
    )
  }
}

function expectHubContext(repositoryId: number) {
  for (const pathname of [
    "/welcome",
    "/notifications",
    "/settings/sharing",
    "/settings/admins",
    "/settings/sessions",
    "/settings/github",
    "/settings/copilot",
    "/settings/audit",
  ]) {
    expect(
      new URL(navigationLink(pathname).href).searchParams.get("repositoryId"),
      `${pathname} must retain the selected repository`,
    ).toBe(String(repositoryId))
  }
}

function expectNoSharingAdministration() {
  for (const pathname of [
    "/settings/sharing",
    "/settings/admins",
    "/settings/sessions",
    "/settings/github",
    "/settings/copilot",
  ]) {
    expect(
      screen
        .queryAllByRole<HTMLAnchorElement>("link")
        .some((link) => new URL(link.href).pathname === pathname),
    ).toBe(false)
  }
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: /(?:enable|disable) public sharing/i }),
  ).not.toBeInTheDocument()
}

describe("Public sharing navigation", () => {
  it("uses the first available repository and retains unread notifications and repository choices without explicit context", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const { repositories, navigation } = store.getWorkspace()
    const first = repositories[0]!
    const unreadCount = navigation!.notificationsUnreadCount
    expect(unreadCount).toBeGreaterThan(0)
    const server = setupServer(...createMockHandlers(store))

    await renderHubFlow(server, "/settings/sharing", { workspaceRoutes })

    expect(navigationLink("/settings/sharing")).toHaveAttribute("aria-current", "page")
    const notifications = navigationLink("/notifications")
    expect(notifications).toHaveAccessibleName(/notifications/i)
    expect(within(notifications).getByText(String(unreadCount))).toBeVisible()
    expectRepository(first.id, first.nameWithOwner)
    expect(navigationLink(`/repositories/${first.id}/new`)).toHaveAccessibleName("Create")
    fireEvent.click(screen.getByRole("button", { name: /^Choose repository\./ }))
    const choices = screen.getByRole("menu", { name: "Repositories" })
    for (const repository of repositories) {
      expect(within(choices).getByRole("link", { name: repository.nameWithOwner })).toHaveAttribute(
        "href",
        expect.stringContaining(`/repositories/${repository.id}`),
      )
    }
    expect(within(choices).getByRole("menuitem", { name: first.nameWithOwner })).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  it("carries the current repository into Public sharing from repository navigation", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2002", { workspaceRoutes })
    const sharing = navigationLink("/settings/sharing")

    expect(new URL(sharing.href).searchParams.get("repositoryId")).toBe("2002")
    await router.settle(() => fireEvent.click(sharing))

    expect(router.state.location.pathname).toBe("/settings/sharing")
    expectRepository(2002, "github/empty")
  })

  it("retains explicit repository context through sharing, Hub settings and notifications navigation", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/settings/sharing?repositoryId=2002", {
      workspaceRoutes,
    })

    for (const destination of ["/settings/copilot", "/notifications", "/settings/sharing"]) {
      expectRepository(2002, "github/empty")
      expectHubContext(2002)
      await router.settle(() => fireEvent.click(navigationLink(destination)))
      expect(router.state.location.pathname).toBe(destination)
      expect(new URLSearchParams(router.state.location.search).get("repositoryId")).toBe("2002")
    }
    expectRepository(2002, "github/empty")
    await router.settle(() => fireEvent.click(navigationLink("/repositories/2002")))
    expect(router.state.location.pathname).toBe("/repositories/2002")
    expectRepository(2002, "github/empty")
  })

  it.each([
    { profile: "owner", login: "octocat", canCreate: true },
    { profile: "reader", login: "mona", canCreate: false },
  ] as const)(
    "keeps $profile repository permissions but hides Hub administrator entries and sharing controls when access is denied",
    async ({ profile, login, canCreate }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select(profile)
      const server = setupServer(...createMockHandlers(store))

      await renderHubFlow(server, "/settings/sharing?repositoryId=2002", { workspaceRoutes })

      expect(screen.getByRole("heading", { name: "Public sharing", level: 1 })).toBeVisible()
      expect(screen.getByRole("button", { name: `Account menu for @${login}` })).toBeVisible()
      expectRepository(2002, "github/empty")
      expect(navigationLink("/notifications")).toHaveAccessibleName(/notifications/i)
      expect(new URL(navigationLink("/notifications").href).searchParams.get("repositoryId")).toBe(
        "2002",
      )
      expect(screen.queryByRole("link", { name: "Create" }) !== null).toBe(canCreate)
      expectNoSharingAdministration()
    },
  )

  it("keeps ordinary navigation but hides administration when sharing permission is denied despite an administrator workspace", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/product/sharing-settings`, () =>
        HttpResponse.json({ ...store.product.getSharingSettings(), canAdminister: false }),
      ),
    )

    await renderHubFlow(server, "/settings/sharing?repositoryId=2002", { workspaceRoutes })

    expect(screen.getByRole("heading", { name: "Public sharing", level: 1 })).toBeVisible()
    expect(screen.getByRole("button", { name: "Account menu for @octocat" })).toBeVisible()
    expectRepository(2002, "github/empty")
    expect(navigationLink("/repositories/2002/new")).toHaveAccessibleName("Create")
    const notifications = navigationLink("/notifications")
    expect(notifications).toHaveAccessibleName(/notifications/i)
    expect(new URL(notifications.href).searchParams.get("repositoryId")).toBe("2002")
    expectNoSharingAdministration()
  })

  it("falls back to Welcome, Repositories and Notifications without invented repository controls when no repositories are accessible", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/workspace`, () =>
        HttpResponse.json({ ...store.getWorkspace(), repositories: [] }),
      ),
    )

    await renderHubFlow(server, "/settings/sharing", { workspaceRoutes })

    expect(navigationLink("/welcome")).toHaveAccessibleName("Welcome")
    expect(navigationLink("/repositories")).toHaveAccessibleName("Repositories")
    expect(navigationLink("/notifications")).toHaveAccessibleName(/notifications/i)
    expect(screen.queryByRole("button", { name: /^Choose repository\./ })).not.toBeInTheDocument()
    for (const name of ["Create", "Prototypes", "Analytics", "Learnings"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument()
    }
    expect(screen.getByRole("button", { name: /(?:enable|disable) public sharing/i })).toBeEnabled()
  })

  it.each([
    { context: "not-a-repository", status: 400 },
    { context: "2002", status: 404 },
  ])(
    "rejects repository context $context with $status instead of silently selecting a repository",
    async ({ context, status }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select("admin")
      const server = setupServer(...createMockHandlers(store))
      server.use(
        http.get(`${store.origin}/api/workspace`, () => {
          const workspace = store.getWorkspace()
          return HttpResponse.json({
            ...workspace,
            repositories: workspace.repositories.filter(({ id }) => id !== 2002),
          })
        }),
      )

      await renderHubFlow(server, `/settings/sharing?repositoryId=${context}`, { workspaceRoutes })

      expect(within(screen.getByRole("alert")).getByText(String(status))).toBeVisible()
      expect(screen.queryByRole("button", { name: /^Choose repository\./ })).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: /(?:enable|disable) public sharing/i }),
      ).not.toBeInTheDocument()
    },
  )
})
