import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-mock-handlers"
import { createMockStore } from "../mocks/create-mock-store"
import { mockDiagnostics } from "../mocks/diagnostics"
import { settingsQuerySchema, settingsWorkspaceResponseSchema } from "../settings-contracts"
import ProductManagementRoute, {
  clientAction as saveManagement,
  clientLoader as loadManagement,
} from "./product-management"
import ProductNewRoute, { clientLoader as loadCatalog } from "./product-new"
import ProductPublicRoute, { clientLoader as loadPublicShare } from "./product-public"
import ProductShareLinksRoute, {
  clientAction as saveShareLinks,
  clientLoader as loadShareLinks,
} from "./product-share-links"
import SettingsAuditRoute, { clientLoader as loadAudit } from "./settings-audit"
import SettingsCopilotRoute, { clientLoader as loadCopilot } from "./settings-copilot"
import SettingsLearningsRoute, {
  clientAction as saveLearnings,
  clientLoader as loadLearnings,
} from "./settings-learnings"
import SettingsNotificationsRoute, {
  clientAction as saveNotifications,
  clientLoader as loadNotifications,
} from "./settings-notifications"
import SettingsSessionsRoute, {
  clientAction as endSession,
  clientLoader as loadSessions,
} from "./settings-sessions"
import SettingsWelcomeRoute, {
  clientAction as hideWelcome,
  clientLoader as loadWelcome,
} from "./settings-welcome"
import { renderHubFlow } from "./fixtures/render-hub-flow"

function ProductNewComponent() {
  return <ProductNewRoute loaderData={useLoaderData<typeof loadCatalog>()} />
}

function ManagementComponent() {
  return <ProductManagementRoute loaderData={useLoaderData<typeof loadManagement>()} />
}

function ShareLinksComponent() {
  return <ProductShareLinksRoute loaderData={useLoaderData<typeof loadShareLinks>()} />
}

function PublicShareComponent() {
  return <ProductPublicRoute loaderData={useLoaderData<typeof loadPublicShare>()} />
}

function AuditComponent() {
  return <SettingsAuditRoute loaderData={useLoaderData<typeof loadAudit>()} />
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

function SessionsComponent() {
  return <SettingsSessionsRoute loaderData={useLoaderData<typeof loadSessions>()} />
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
    path: "/repositories/:repositoryId/prototypes/manage",
    loader: loadManagement,
    action: saveManagement,
    Component: ManagementComponent,
  },
  {
    path: "/repositories/:repositoryId/prototypes/:prototypeId/share-links",
    loader: loadShareLinks,
    action: saveShareLinks,
    Component: ShareLinksComponent,
  },
  {
    path: "/settings/audit",
    loader: (args) => loadAudit({ ...args, serverLoader: unavailableServerRoute }),
    Component: AuditComponent,
  },
  {
    path: "/settings/copilot",
    loader: (args) => loadCopilot({ ...args, serverLoader: unavailableServerRoute }),
    Component: CopilotComponent,
  },
  {
    path: "/repositories/:repositoryId/learnings",
    loader: loadLearnings,
    action: saveLearnings,
    Component: LearningsComponent,
  },
  {
    path: "/notifications",
    loader: (args) => loadNotifications({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => saveNotifications({ ...args, serverAction: unavailableServerRoute }),
    Component: NotificationsComponent,
  },
  {
    path: "/welcome",
    loader: (args) => loadWelcome({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => hideWelcome({ ...args, serverAction: unavailableServerRoute }),
    Component: WelcomeComponent,
  },
]

const publicRoutes: RouteObject[] = [
  {
    path: "/shared/:shareId",
    loader: loadPublicShare,
    Component: PublicShareComponent,
  },
  {
    path: "/settings/sessions",
    loader: (args) => loadSessions({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => endSession({ ...args, serverAction: unavailableServerRoute }),
    Component: SessionsComponent,
  },
]

describe("Hub expanded frontend flows", () => {
  it("keeps the Notifications navigation label when moving between repository and settings pages", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001", { workspaceRoutes })

    function notificationsLink() {
      const link = screen
        .getAllByRole<HTMLAnchorElement>("link")
        .find((item) => new URL(item.href).pathname === "/notifications")
      if (!link) throw new Error("The workspace must offer notifications navigation.")
      expect(link).toHaveTextContent("Notifications")
      expect(link).toHaveAccessibleName(/notifications/i)
      return link
    }

    await router.settle(() => fireEvent.click(notificationsLink()))
    expect(router.state.location.pathname).toBe("/notifications")
    expect(notificationsLink()).toHaveAttribute("aria-current", "page")
    await router.settle(() => router.navigate("/settings/copilot"))
    notificationsLink()
    await router.settle(() => router.navigate("/repositories/2001"))
    notificationsLink()
  })

  it("shows connected Copilot with its owner and required disconnect consent as normal product UI", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    await renderHubFlow(server, "/settings/copilot", { workspaceRoutes })

    expect(await screen.findByRole("heading", { name: "Copilot is connected" })).toBeInTheDocument()
    expect(screen.getByText(/connected Copilot\./)).toBeVisible()
    expect(
      screen.getByRole("checkbox", {
        name: "I understand and confirm disconnecting Copilot for this Hub.",
      }),
    ).toBeRequired()
    expect(screen.getByRole("button", { name: "Disconnect Copilot" })).toBeVisible()
    expect(screen.getByRole("main")).not.toHaveTextContent(/\b(mock|synthetic|simulated)\b/i)
  })

  it("continues a prototype brief in Copilot without creating a local prototype or Build", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const templateRoute = "/welcome?step=2#intro"
    store.product.updateMetadata("2001", "1", {
      name: "Welcome",
      description: null,
      startPage: templateRoute,
    })
    const prototypeCount = store.flowContext.resources.prototypes.length
    const buildCount = store.flowContext.resources.builds.length
    const server = setupServer(...createMockHandlers(store))
    const creates = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (
        request.method === "POST" &&
        new URL(request.url).pathname === "/api/repositories/2001/prototypes"
      )
        creates()
    })
    const router = await renderHubFlow(server, "/repositories/2001/new", { workspaceRoutes })
    fireEvent.change(screen.getByRole("textbox", { name: "What should we create?" }), {
      target: { value: "A simpler onboarding flow" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Template: Default" }))
    fireEvent.click(screen.getByRole("option", { name: `Welcome ${templateRoute}` }))
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Create prototype" })),
    )

    const dialog = screen.getByRole("dialog", { name: "Continue in Copilot app" })
    const openApp = within(dialog).getByRole<HTMLAnchorElement>("link", {
      name: /open copilot app/i,
    })
    const launcher = new URL(openApp.href)
    const open = launcher.searchParams.get("open")
    if (!open) throw new Error("The Copilot link must contain its app destination.")
    const session = new URL(open)
    expect(launcher.origin + launcher.pathname).toBe("https://github.com/copilot/app/launch")
    expect(session.searchParams.get("repo")).toBe("github/prototype")
    expect(session.searchParams.get("prompt")).toContain("A simpler onboarding flow")
    expect(session.searchParams.get("prompt")).toContain(encodeURIComponent(templateRoute))
    expect(session.searchParams.get("prompt")).toContain("startPage")
    expect(creates).not.toHaveBeenCalled()
    expect(store.flowContext.resources.prototypes).toHaveLength(prototypeCount)
    expect(store.flowContext.resources.builds).toHaveLength(buildCount)
    expect(screen.queryByRole("link", { name: "Open prototype" })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/repositories/2001/new")
  })

  it("keeps prototype creation and management unavailable to a reader", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("reader")
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001", { workspaceRoutes })
    expect(screen.queryByRole("link", { name: "Edit prototype listings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument()

    await router.settle(() => router.navigate("/repositories/2001/new"))

    expect(screen.getByRole("button", { name: "Create prototype" })).toBeDisabled()
    expect(screen.getByRole("main")).toHaveTextContent(/do not have permission to create/i)
    expect(
      screen.queryByRole("dialog", { name: "Continue in Copilot app" }),
    ).not.toBeInTheDocument()
  })

  it("shares management edits with the existing preview and repository", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const selectedBuild = store.getPrototype("2001", "1").selectedBuild?.number
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001", { workspaceRoutes })
    const manage = screen.getByRole("link", { name: "Edit prototype listings" })
    expect(manage).toHaveAttribute("href", "/repositories/2001/prototypes/manage")
    await router.settle(() => fireEvent.click(manage))
    expect(router.state.location.pathname).toBe("/repositories/2001/prototypes/manage")
    const branch = store.getPrototype("2001", "1").prototype.branchName
    fireEvent.click(screen.getByRole("button", { name: `Edit details: ${branch}` }))
    const editor = screen.getByRole("dialog", { name: "Edit prototype details" })
    fireEvent.change(within(editor).getByRole("textbox", { name: "Name" }), {
      target: { value: "Refined onboarding" },
    })
    fireEvent.change(within(editor).getByRole("textbox", { name: "Description (optional)" }), {
      target: { value: "Guide a new visitor through one useful task." },
    })
    fireEvent.change(within(editor).getByRole("textbox", { name: "Start page (optional)" }), {
      target: { value: "/welcome?step=1#intro" },
    })
    await router.settle(() =>
      fireEvent.click(within(editor).getByRole("button", { name: "Save details" })),
    )
    expect(editor).not.toBeVisible()

    const prototypePath = "/repositories/2001/prototypes/1"
    await router.settle(() => router.navigate(prototypePath))
    expect(
      screen.getByTitle(`Refined onboarding, Build ${selectedBuild} preview`),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }))
    expect(
      within(screen.getByRole("dialog")).getByRole("textbox", { name: "Description" }),
    ).toHaveValue("Guide a new visitor through one useful task.")
    await router.settle(() => router.navigate("/repositories/2001?q=Refined"))
    const repositoryLink = screen.getByRole("link", { name: "Refined onboarding" })
    expect(new URL((repositoryLink as HTMLAnchorElement).href).pathname).toBe(prototypePath)
  }, 15_000)

  it("keeps an invalid management draft without reloading and saves its corrected local route", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/prototypes/manage", {
      workspaceRoutes,
    })
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Edit details: ${store.getPrototype("2001", "1").prototype.branchName}`,
      }),
    )
    const editor = screen.getByRole("dialog", { name: "Edit prototype details" })
    const name = within(editor).getByRole("textbox", { name: "Name" })
    const startPage = within(editor).getByRole("textbox", { name: "Start page (optional)" })
    fireEvent.change(name, { target: { value: "Preserved management draft" } })
    fireEvent.change(startPage, { target: { value: "//external.example.test/welcome" } })
    const failedReads = vi.fn(() =>
      HttpResponse.json({ error: "Loaded resources are unavailable." }, { status: 503 }),
    )
    const mutations = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (request.method === "PATCH") mutations()
    })
    server.use(http.get(`${store.origin}/api/*`, failedReads))

    await router.settle(() =>
      fireEvent.click(within(editor).getByRole("button", { name: "Save details" })),
    )

    expect(await within(editor).findByRole("alert")).toHaveTextContent(/local route/i)
    expect(name).toHaveValue("Preserved management draft")
    expect(startPage).toHaveValue("//external.example.test/welcome")
    expect(mutations).not.toHaveBeenCalled()
    expect(failedReads).not.toHaveBeenCalled()
    expect(store.getPrototype("2001", "1").prototype.name).toBe("Welcome")
    server.resetHandlers()
    fireEvent.change(startPage, { target: { value: "/welcome?step=2#heading" } })
    await router.settle(() =>
      fireEvent.click(within(editor).getByRole("button", { name: "Save details" })),
    )
    await waitFor(() => expect(editor).not.toBeVisible())
    expect(
      store.product.getManagement("2001").registered.find((item) => item.id === "1"),
    ).toMatchObject({
      name: "Preserved management draft",
      startPage: "/welcome?step=2#heading",
    })
  })

  it("opens a newly created fixed-Build share after sign-out without loading a private workspace", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(
      server,
      "/repositories/2001/prototypes/1/share-links?build=3",
      {
        workspaceRoutes,
        publicRoutes,
      },
    )
    fireEvent.change(await screen.findByRole("textbox", { name: "Label" }), {
      target: { value: "Stakeholder review" },
    })
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Create share link" })),
    )
    const heading = await screen.findByRole("heading", { name: "Stakeholder review" })
    const row = heading.closest("li")
    if (!row) throw new Error("The created link must be listed with its controls.")
    const open = within(row).getByRole("link", { name: "Open" })
    expect(open).not.toHaveAttribute("target", "_blank")
    const sharedPath = new URL((open as HTMLAnchorElement).href).pathname
    const privateReads = vi.fn(() =>
      HttpResponse.json({ error: "Private workspace must not be loaded." }, { status: 503 }),
    )
    server.use(http.get(`${store.origin}/api/workspace`, privateReads))
    fireEvent.click(screen.getByRole("button", { name: "Account menu for @octocat" }))
    await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })))
    await screen.findByRole("button", { name: "Sign in with GitHub" })

    await router.settle(() => router.navigate(sharedPath))

    expect(await screen.findByTitle("Welcome · Build 3")).toBeInTheDocument()
    expect(store.session.read().viewer).toBeNull()
    expect(privateReads).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument()
  })

  it.each([
    { shareId: "demo-expired", heading: /link has expired/i },
    { shareId: "demo-revoked", heading: /link was revoked/i },
  ])(
    "shows an unavailable public preview for $shareId while signed out",
    async ({ shareId, heading }) => {
      const store = createMockStore({ origin: window.location.origin })
      store.session.select("signed-out")
      const server = setupServer(...createMockHandlers(store))
      const privateReads = vi.fn(() =>
        HttpResponse.json({ error: "Private workspace must not be loaded." }, { status: 503 }),
      )
      server.use(http.get(`${store.origin}/api/workspace`, privateReads))

      await renderHubFlow(server, `/shared/${shareId}`, { publicRoutes })

      expect(await screen.findByRole("heading", { name: heading })).toBeVisible()
      expect(document.querySelector("iframe")).not.toBeInTheDocument()
      expect(privateReads).not.toHaveBeenCalled()
    },
  )

  it("keeps inbox read state when opening its real seeded conversation and returning", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/notifications", { workspaceRoutes })
    const notification = store.settings
      .getWorkspace(settingsQuerySchema.parse({}))
      .notifications.items.find((item) => !item.read)
    if (!notification) throw new Error("The inbox needs an unread activity.")
    const message = (
      await within(screen.getByRole("region", { name: "Inbox" })).findAllByRole("link")
    ).find(
      (link) =>
        new URL((link as HTMLAnchorElement).href).searchParams.get("notification") ===
        String(notification.id),
    )
    if (!message) throw new Error("The unread activity must have its conversation link.")
    const row = message.closest("li")
    if (!row) throw new Error("An inbox item must have its own read-state control.")
    await router.settle(() =>
      fireEvent.click(
        within(row).getByRole("button", { name: `Mark as read: ${notification.actor.login}` }),
      ),
    )
    expect(
      within(row).getByRole("button", { name: `Mark as unread: ${notification.actor.login}` }),
    ).toBeEnabled()

    await router.settle(() => fireEvent.click(within(row).getByRole("link")))

    const conversation = screen.getByRole("dialog", { name: "Conversation" })
    expect(conversation).toBeVisible()
    const target = new URL(notification.path, store.origin)
    expect(router.state.location.pathname).toBe(target.pathname)
    expect(new URLSearchParams(router.state.location.search).get("build")).toBe(
      target.searchParams.get("build"),
    )
    expect(new URLSearchParams(router.state.location.search).get("comment")).toBe(
      String(notification.target.threadId),
    )
    await router.go(-1)
    const returned = (
      await within(screen.getByRole("region", { name: "Inbox" })).findAllByRole("link")
    ).find(
      (link) =>
        new URL((link as HTMLAnchorElement).href).searchParams.get("notification") ===
        String(notification.id),
    )
    if (!returned) throw new Error("The returned inbox must contain the same activity.")
    const returnedRow = returned.closest("li")
    if (!returnedRow) throw new Error("The returned inbox item must retain its controls.")
    expect(
      within(returnedRow).getByRole("button", {
        name: `Mark as unread: ${notification.actor.login}`,
      }),
    ).toBeEnabled()
  })

  it("loads the remaining inbox page without duplicate activity and resets pagination for unread filtering", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const first = store.settings.getWorkspace(settingsQuerySchema.parse({}))
    const second = store.settings.getWorkspace(settingsQuerySchema.parse({ page: 2 }))
    const unread = store.settings.getWorkspace(settingsQuerySchema.parse({ unread: "true" }))
    const router = await renderHubFlow(server, "/notifications", { workspaceRoutes })
    const inbox = screen.getByRole("region", { name: "Inbox" })
    expect(await within(inbox).findAllByRole("link")).toHaveLength(50)

    await router.settle(() => fireEvent.click(screen.getByRole("button", { name: "Load more" })))

    const links = within(inbox).getAllByRole<HTMLAnchorElement>("link")
    const ids = links.map((link) => new URL(link.href).searchParams.get("notification"))
    const expected = [...first.notifications.items, ...second.notifications.items]
    expect(ids).toEqual(expected.map(({ id }) => String(id)))
    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument()

    await router.settle(() =>
      fireEvent.click(within(inbox).getByRole("button", { name: "Unread" })),
    )

    expect(
      (
        await within(
          screen.getByRole("region", { name: "Inbox" }),
        ).findAllByRole<HTMLAnchorElement>("link")
      ).map((link) => new URL(link.href).searchParams.get("notification")),
    ).toEqual(unread.notifications.items.map(({ id }) => String(id)))
    expect(
      within(screen.getByRole("region", { name: "Inbox" })).getByRole("button", { name: "Unread" }),
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("replaces inbox rows after successful route revalidation and restores them when data returns", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const loadedCounts: Promise<number>[] = []
    server.events.on("response:mocked", ({ request, response }) => {
      if (new URL(request.url).pathname === "/api/settings/workspace") {
        loadedCounts.push(
          response
            .clone()
            .json()
            .then(
              (payload: unknown) =>
                settingsWorkspaceResponseSchema.parse(payload).notifications.items.length,
            ),
        )
      }
    })
    const router = await renderHubFlow(server, "/notifications", {
      workspaceRoutes,
      withTools: true,
    })
    try {
      const inbox = screen.getByRole("region", { name: "Inbox" })
      const first = await within(inbox).findAllByRole<HTMLAnchorElement>("link")
      expect(first).toHaveLength(50)
      const expectedIds = first.map((link) => new URL(link.href).searchParams.get("notification"))
      expect((await Promise.all(loadedCounts)).at(-1)).toBe(50)

      await router.settle(() =>
        fireEvent.change(screen.getByRole("combobox", { name: "API scenario" }), {
          target: { value: "empty" },
        }),
      )

      expect((await Promise.all(loadedCounts)).at(-1)).toBe(0)
      await waitFor(() =>
        expect(
          within(screen.getByRole("region", { name: "Inbox" })).queryAllByRole("link"),
        ).toHaveLength(0),
      )
      expect(
        await within(screen.getByRole("region", { name: "Inbox" })).findByText("No activity yet"),
      ).toBeVisible()

      await router.settle(() =>
        fireEvent.change(screen.getByRole("combobox", { name: "API scenario" }), {
          target: { value: "normal" },
        }),
      )

      expect((await Promise.all(loadedCounts)).at(-1)).toBe(50)
      await waitFor(() =>
        expect(
          within(screen.getByRole("region", { name: "Inbox" }))
            .getAllByRole<HTMLAnchorElement>("link")
            .map((link) => new URL(link.href).searchParams.get("notification")),
        ).toEqual(expectedIds),
      )
    } finally {
      router.close()
      mockDiagnostics.selectScenario("normal")
      mockDiagnostics.clear()
    }
  })

  it("abandons a delayed Welcome dismissal on sign-out without saving hidden navigation", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const mutationStarted = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (request.method === "POST" && new URL(request.url).pathname === "/api/settings/actions") {
        mutationStarted()
      }
    })
    const router = await renderHubFlow(server, "/welcome", { workspaceRoutes })
    const hide = await screen.findByRole("button", { name: "Hide welcome" })
    const nativeFetch = globalThis.fetch
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (
        init?.method === "POST" &&
        new URL(url, window.location.origin).pathname === "/api/settings/actions"
      ) {
        const headers = new Headers(init.headers)
        headers.set("X-Replica-Mock-Scenario", "loading")
        return nativeFetch(input, { ...init, headers })
      }
      return nativeFetch(input, init)
    })
    fireEvent.click(hide)
    await waitFor(() => expect(mutationStarted).toHaveBeenCalledOnce())
    expect(store.settings.getNavigationState().welcomeHidden).toBe(false)
    const signOut = new FormData()
    signOut.set("intent", "sign-out")
    await router.settle(() =>
      router.navigate("/session", {
        formMethod: "post",
        formData: signOut,
      }),
    )
    await screen.findByRole("button", { name: "Sign in with GitHub" })
    await new Promise((resolve) => window.setTimeout(resolve, 1600))
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" })),
    )
    await screen.findByRole("button", { name: "Account menu for @octocat" })

    expect(store.settings.getNavigationState().welcomeHidden).toBe(false)
  }, 15_000)

  it.each(["/repositories/2001/learnings", "/settings/sessions"])(
    "signs out through the retained settings control at %s",
    async (path) => {
      const store = createMockStore({ origin: window.location.origin })
      const server = setupServer(...createMockHandlers(store))
      const router = await renderHubFlow(server, path, { workspaceRoutes, publicRoutes })
      if (path === "/settings/sessions") {
        fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))
      } else {
        fireEvent.click(await screen.findByRole("button", { name: "Account menu for @octocat" }))
        fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))
      }
      await router.settle()

      expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument()
      expect(router.state.location.pathname).toBe("/sign-in")
      expect(store.session.read().viewer).toBeNull()
    },
  )

  it("retains the public session-ended result without a private workspace or changes to share links", async () => {
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const server = setupServer(...createMockHandlers(store))
    const privateReads = vi.fn(() =>
      HttpResponse.json({ error: "Private workspace must not be loaded." }, { status: 503 }),
    )
    server.use(http.get(`${store.origin}/api/workspace`, privateReads))
    const router = await renderHubFlow(server, "/settings/sessions", { publicRoutes })
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "I understand this will end everyone's sessions, including my own.",
      }),
    )
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "End all sessions" })),
    )

    expect(
      await screen.findByRole("heading", { name: "All existing Hub sessions ended" }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/settings/sessions")
    expect(store.session.read().viewer).toBeNull()
    expect(privateReads).not.toHaveBeenCalled()
    expect(store.product.getPublicShare("demo-active").state).toBe("active")
    expect(screen.queryByRole("button", { name: "End all sessions" })).not.toBeInTheDocument()
  })
})
