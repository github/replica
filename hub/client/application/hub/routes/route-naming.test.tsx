import type { RouteConfigEntry } from "@react-router/dev/routes"
import { fireEvent, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it, vi } from "vitest"

import routeConfig from "../routes"
import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { settingsQuerySchema } from "../settings-contracts"
import { clientLoader as redirectRepositorySettings } from "./legacy-repository-settings"
import { clientLoader as redirectSharing } from "./legacy-sharing"
import ProductSharingSettingsRoute, {
  clientAction as saveSharing,
  clientLoader as loadSharing,
} from "./product-sharing-settings"
import SettingsAnalyticsRoute, {
  clientAction as saveAnalytics,
  clientLoader as loadAnalytics,
} from "./settings-analytics"
import SettingsLearningsRoute, {
  clientAction as saveLearnings,
  clientLoader as loadLearnings,
} from "./settings-learnings"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function AnalyticsComponent() {
  return <SettingsAnalyticsRoute loaderData={useLoaderData<typeof loadAnalytics>()} />
}

function LearningsComponent() {
  return <SettingsLearningsRoute loaderData={useLoaderData<typeof loadLearnings>()} />
}

function SharingComponent() {
  return <ProductSharingSettingsRoute loaderData={useLoaderData<typeof loadSharing>()} />
}

function unavailableServerRoute(): Promise<never> {
  return Promise.reject(new Error("The mock frontend must not call a server route."))
}

const workspaceRoutes: RouteObject[] = [
  {
    path: "/repositories/:repositoryId/analytics",
    loader: (args) => loadAnalytics({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => saveAnalytics({ ...args, serverAction: unavailableServerRoute }),
    Component: AnalyticsComponent,
  },
  {
    path: "/repositories/:repositoryId/learnings",
    loader: (args) => loadLearnings({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => saveLearnings({ ...args, serverAction: unavailableServerRoute }),
    Component: LearningsComponent,
  },
  {
    path: "/settings/sharing",
    loader: loadSharing,
    action: saveSharing,
    Component: SharingComponent,
  },
  {
    path: "/settings/:section",
    loader: redirectRepositorySettings,
  },
  {
    path: "/admin/sharing",
    loader: redirectSharing,
  },
]

function registeredPaths(entries: RouteConfigEntry[]): string[] {
  return entries.flatMap((entry) => [
    ...(entry.path ? [entry.path] : []),
    ...registeredPaths(entry.children ?? []),
  ])
}

describe("Hub primary route names", () => {
  it("registers the canonical page URLs in the application, not just the test router", () => {
    expect(registeredPaths(routeConfig)).toEqual(
      expect.arrayContaining([
        "repositories",
        "repositories/:repositoryId",
        "repositories/:repositoryId/new",
        "repositories/:repositoryId/analytics",
        "repositories/:repositoryId/learnings",
        "settings/sharing",
        "settings/audit",
        "settings/admins",
        "settings/sessions",
        "settings/github",
        "settings/copilot",
        "welcome",
        "notifications",
      ]),
    )
  })

  it("opens the first accessible repository from the repositories entry point", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/workspace`, () =>
        HttpResponse.json({
          ...store.getWorkspace(),
          repositories: store.getWorkspace().repositories.slice(1),
        }),
      ),
    )

    const router = await renderHubFlow(server, "/repositories", { workspaceRoutes })

    expect(router.state.location.pathname).toBe("/repositories/2002")
    expect(
      screen.getByRole("button", { name: "Choose repository. github/empty selected" }),
    ).toBeVisible()
  })

  it("keeps the empty workspace outcome at the repositories entry point", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/workspace`, () =>
        HttpResponse.json({ ...store.getWorkspace(), repositories: [] }),
      ),
    )

    const router = await renderHubFlow(server, "/repositories", { workspaceRoutes })

    expect(router.state.location.pathname).toBe("/repositories")
    expect(screen.getByRole("heading", { name: "No repositories available" })).toBeVisible()
    expect(screen.queryByRole("button", { name: /^Choose repository\./ })).not.toBeInTheDocument()
  })

  it("sends a signed-out repositories visit to sign-in without reading a private workspace", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("signed-out")
    const privateReads = vi.fn(() =>
      HttpResponse.json({ error: "Private workspace must not be loaded." }, { status: 503 }),
    )
    const server = setupServer(...createMockHandlers(store))
    server.use(http.get(`${store.origin}/api/workspace`, privateReads))

    const router = await renderHubFlow(server, "/repositories", { workspaceRoutes })

    expect(router.state.location.pathname).toBe("/sign-in")
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
    expect(privateReads).not.toHaveBeenCalled()
  })

  it("reads and pauses the path repository's destination despite a conflicting query", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.settings.mutate({
      operation: "analytics-save",
      repositoryId: "2002",
      configuration: {
        provider: "segment",
        region: "eu",
        name: "",
        eventTypes: ["build_published"],
        history: "new",
      },
    })
    const firstQuery = settingsQuerySchema.parse({ repositoryId: "2001" })
    const secondQuery = settingsQuerySchema.parse({ repositoryId: "2002" })
    const firstDestinations = store.settings.getWorkspace(firstQuery).analytics
    const secondDestination = store.settings.getWorkspace(secondQuery).analytics[0]!
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2002/analytics?repositoryId=2001", {
      workspaceRoutes,
    })

    expect(
      screen.getByRole("button", { name: "Choose repository. github/empty selected" }),
    ).toBeVisible()
    const destination = screen.getByRole("region", { name: "Segment" })
    expect(within(destination).getByRole("combobox", { name: "Region" })).toHaveValue("eu")
    const pause = within(destination).getByRole("button", { name: "Pause" })
    const form = pause.closest("form")!
    expect(new URL(form.action).pathname).toBe("/repositories/2002/analytics")
    form.action = `/repositories/2002/analytics?repositoryId=2001&destinationId=${secondDestination.id}`

    await router.settle(() => fireEvent.click(pause))

    expect(
      within(screen.getByRole("region", { name: "Segment" })).getByRole("button", {
        name: "Resume",
      }),
    ).toBeEnabled()
    expect(store.settings.getWorkspace(secondQuery).analytics[0]).toMatchObject({
      id: secondDestination.id,
      enabled: false,
    })
    expect(store.settings.getWorkspace(firstQuery).analytics).toEqual(firstDestinations)
    expect(router.state.location.pathname).toBe("/repositories/2002/analytics")
  })

  it("runs and accepts learnings for a non-first path repository without changing the query repository", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const firstQuery = settingsQuerySchema.parse({ repositoryId: "2001" })
    const secondQuery = settingsQuerySchema.parse({ repositoryId: "2002" })
    const firstLearnings = store.settings.getWorkspace(firstQuery).learnings
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2002/learnings?repositoryId=2001", {
      workspaceRoutes,
    })
    const run = screen.getByRole("button", { name: "Find learnings now" })
    expect(new URL(run.closest("form")!.action).pathname).toBe("/repositories/2002/learnings")
    expect(screen.queryAllByRole("article")).toHaveLength(0)

    await router.settle(() => fireEvent.click(run))

    const learning = store.settings.getWorkspace(secondQuery).learnings[0]!
    const suggestion = screen.getByRole("article", { name: learning.content })
    const accept = within(suggestion).getByRole("button", { name: "Accept" })
    expect(new URL(accept.closest("form")!.action).pathname).toBe("/repositories/2002/learnings")
    await router.settle(() => fireEvent.click(accept))

    expect(store.settings.getWorkspace(secondQuery).learnings[0]).toMatchObject({
      id: learning.id,
      state: "accepted",
    })
    expect(store.settings.getWorkspace(firstQuery).learnings).toEqual(firstLearnings)
    expect(
      within(screen.getByRole("article", { name: learning.content })).getByRole("button", {
        name: "Retire",
      }),
    ).toBeEnabled()
    expect(router.state.location.pathname).toBe("/repositories/2002/learnings")
  })

  it("submits Public sharing changes on its canonical URL and retains the repository context", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const enabled = store.product.getSharingSettings().enabled
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/settings/sharing?repositoryId=2002", {
      workspaceRoutes,
    })
    const submit = screen.getByRole("button", {
      name: enabled ? "Disable public sharing" : "Enable public sharing",
    })
    const target = new URL(submit.closest("form")!.action)
    expect(target.pathname).toBe("/settings/sharing")
    expect(target.searchParams.get("repositoryId")).toBe("2002")
    fireEvent.click(screen.getByRole("checkbox"))

    await router.settle(() => fireEvent.click(submit))

    expect(store.product.getSharingSettings().enabled).toBe(!enabled)
    expect(router.state.location.pathname).toBe("/settings/sharing")
    expect(new URLSearchParams(router.state.location.search).get("repositoryId")).toBe("2002")
  })

  it.each([
    { legacy: "/settings/analytics", canonical: "/repositories/2002/analytics" },
    { legacy: "/settings/learnings", canonical: "/repositories/2002/learnings" },
    { legacy: "/admin/sharing", canonical: "/settings/sharing" },
  ])(
    "redirects $legacy to $canonical without losing relevant query state",
    async ({ legacy, canonical }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select("admin")
      const server = setupServer(...createMockHandlers(store))

      const router = await renderHubFlow(
        server,
        `${legacy}?repositoryId=2002&mockScenario=normal&q=retained`,
        { workspaceRoutes },
      )

      expect(router.state.location.pathname).toBe(canonical)
      const search = new URLSearchParams(router.state.location.search)
      expect(search.get("mockScenario")).toBe("normal")
      expect(search.get("q")).toBe("retained")
      expect(search.get("repositoryId")).toBe(canonical === "/settings/sharing" ? "2002" : null)
      expect(
        screen.getByRole("button", { name: "Choose repository. github/empty selected" }),
      ).toBeVisible()
    },
  )

  it.each(["analytics", "learnings"])(
    "keeps first-accessible-repository selection for legacy %s links without a repository",
    async (section) => {
      const store = createMockStore({ origin: window.location.origin })
      const server = setupServer(...createMockHandlers(store))
      server.use(
        http.get(`${store.origin}/api/workspace`, () =>
          HttpResponse.json({
            ...store.getWorkspace(),
            repositories: store.getWorkspace().repositories.slice(1),
          }),
        ),
      )

      const router = await renderHubFlow(server, `/settings/${section}`, { workspaceRoutes })

      expect(router.state.location.pathname).toBe(`/repositories/2002/${section}`)
      expect(
        screen.getByRole("button", { name: "Choose repository. github/empty selected" }),
      ).toBeVisible()
    },
  )

  it.each([
    { entry: "/repositories/not-a-repository/analytics?repositoryId=2001", status: 400 },
    { entry: "/repositories/9999/learnings?repositoryId=2001", status: 404 },
    { entry: "/settings/analytics?repositoryId=not-a-repository", status: 400 },
    { entry: "/settings/learnings?repositoryId=9999", status: 404 },
    { entry: "/settings/not-connected", status: 404 },
  ])(
    "rejects $entry with $status instead of selecting another repository",
    async ({ entry, status }) => {
      const store = createMockStore({ origin: window.location.origin })
      const server = setupServer(...createMockHandlers(store))

      await renderHubFlow(server, entry, { workspaceRoutes })

      expect(within(screen.getByRole("alert")).getByText(String(status))).toBeVisible()
      expect(screen.queryByRole("button", { name: /^Choose repository\./ })).not.toBeInTheDocument()
    },
  )

  it("fails visibly when a legacy repository page has no accessible repository", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    server.use(
      http.get(`${store.origin}/api/workspace`, () =>
        HttpResponse.json({ ...store.getWorkspace(), repositories: [] }),
      ),
    )

    await renderHubFlow(server, "/settings/analytics", { workspaceRoutes })

    expect(within(screen.getByRole("alert")).getByText("404")).toBeVisible()
    expect(screen.queryByRole("button", { name: "Add destination" })).not.toBeInTheDocument()
  })
})
