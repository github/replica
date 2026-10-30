import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { settingsQuerySchema } from "../settings-contracts"
import ProductManagementRoute, {
  clientAction as saveManagement,
  clientLoader as loadManagement,
} from "./product-management"
import ProductNewRoute, {
  clientAction as createPrototype,
  clientLoader as loadCatalog,
} from "./product-new"
import ProductPublicRoute, { clientLoader as loadPublicShare } from "./product-public"
import ProductShareLinksRoute, {
  clientAction as saveShareLinks,
  clientLoader as loadShareLinks,
} from "./product-share-links"
import SettingsAuditRoute, { clientLoader as loadAudit } from "./settings-audit"
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
import { renderHubFlow } from "./test-fixture"

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

function LearningsComponent() {
  return <SettingsLearningsRoute loaderData={useLoaderData<typeof loadLearnings>()} />
}

function AuditComponent() {
  return <SettingsAuditRoute loaderData={useLoaderData<typeof loadAudit>()} />
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
    action: createPrototype,
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
    path: "/settings/learnings",
    loader: (args) => loadLearnings({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => saveLearnings({ ...args, serverAction: unavailableServerRoute }),
    Component: LearningsComponent,
  },
  {
    path: "/settings/audit",
    loader: (args) => loadAudit({ ...args, serverLoader: unavailableServerRoute }),
    Component: AuditComponent,
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
  // This four-page flow measured 8.6s on Windows, beyond the default 5s case budget.
  it("creates a local prototype and shares management edits with its preview and repository", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/repositories/2001/new", { workspaceRoutes })
    const brief = screen.getByRole("textbox", { name: "What should we create?" })
    fireEvent.change(brief, { target: { value: "A simpler onboarding flow" } })
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Create mock prototype" })),
    )
    const open = screen.getByRole("link", { name: "Open created mock prototype" })
    const prototypePath = new URL((open as HTMLAnchorElement).href).pathname
    const prototypeId = Number(prototypePath.split("/").at(-1))
    await router.settle(() => fireEvent.click(open))
    expect(screen.getByTitle("A simpler onboarding flow, Build 1 preview")).toBeVisible()

    await router.settle(() => router.navigate("/repositories/2001/prototypes/manage"))
    const branch = store.getPrototype(2001, prototypeId).prototype.branchName
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

    await router.settle(() => router.navigate(prototypePath))
    expect(screen.getByTitle("Refined onboarding, Build 1 preview")).toBeInTheDocument()
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
        name: `Edit details: ${store.getPrototype(2001, 1).prototype.branchName}`,
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
    expect(store.getPrototype(2001, 1).prototype.name).toBe("Welcome")
    server.resetHandlers()
    fireEvent.change(startPage, { target: { value: "/welcome?step=2#heading" } })
    await router.settle(() =>
      fireEvent.click(within(editor).getByRole("button", { name: "Save details" })),
    )
    await waitFor(() => expect(editor).not.toBeVisible())
    expect(
      store.product.getManagement(2001).registered.find((item) => item.id === 1),
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
      fireEvent.click(screen.getByRole("button", { name: "Create mock share link" })),
    )
    const heading = await screen.findByRole("heading", { name: "Stakeholder review" })
    const row = heading.closest("li")
    if (!row) throw new Error("The created link must be listed with its controls.")
    const open = within(row).getByRole("link", { name: "Open local preview" })
    expect(open).not.toHaveAttribute("target", "_blank")
    const sharedPath = new URL((open as HTMLAnchorElement).href).pathname
    const privateReads = vi.fn(() =>
      HttpResponse.json({ error: "Private workspace must not be loaded." }, { status: 503 }),
    )
    server.use(http.get(`${store.origin}/api/workspace`, privateReads))
    fireEvent.click(screen.getByRole("button", { name: "Account menu for @octocat" }))
    await router.settle(() => fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" })))
    await screen.findByRole("button", { name: "Mock sign in as Octocat" })

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

  it("retains a failed learning edit and shares a successful decision with recall, audit and the reader", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/settings/learnings?repositoryId=2001", {
      workspaceRoutes,
    })
    const suggestion = await screen.findByRole("article", {
      name: "Keep a visible label above every form field.",
    })
    fireEvent.click(within(suggestion).getByRole("button", { name: "Edit and accept" }))
    const wording = within(suggestion).getByRole("textbox", { name: "Mock guidance wording" })
    fireEvent.change(wording, { target: { value: "Use a visible label on every field." } })
    const failedReads = vi.fn(() =>
      HttpResponse.json({ error: "Loaded settings are unavailable." }, { status: 503 }),
    )
    server.use(
      http.post(`${store.origin}/api/settings/actions`, () =>
        HttpResponse.json({ error: "Decisions are temporarily unavailable." }, { status: 503 }),
      ),
      http.get(`${store.origin}/api/*`, failedReads),
    )

    await router.settle(() =>
      fireEvent.click(within(suggestion).getByRole("button", { name: "Accept with this wording" })),
    )

    expect(
      (await screen.findByText("Decisions are temporarily unavailable.")).closest('[role="alert"]'),
    ).toBeInTheDocument()
    expect(wording).toHaveValue("Use a visible label on every field.")
    expect(failedReads).not.toHaveBeenCalled()
    server.resetHandlers()
    await router.settle(() =>
      fireEvent.click(within(suggestion).getByRole("button", { name: "Accept with this wording" })),
    )
    expect(
      await screen.findByRole("article", { name: "Use a visible label on every field." }),
    ).toBeInTheDocument()
    expect(
      screen
        .getAllByRole("region", { name: "Mock recall preview" })
        .map((region) => region.textContent)
        .join("\n"),
    ).toContain("Use a visible label on every field.")
    await router.settle(() => router.navigate("/settings/audit?repositoryId=2001"))
    expect(await screen.findByRole("cell", { name: "learning-decide" })).toBeInTheDocument()
    const profileForm = new FormData()
    profileForm.set("profile", "reader")
    await act(async () =>
      router.fetch("reader-profile", "root", "/session", {
        formMethod: "post",
        formData: profileForm,
      }),
    )
    await router.settle(() => router.navigate("/settings/learnings?repositoryId=2001"))
    expect(
      await screen.findByRole("article", { name: "Use a visible label on every field." }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Retire" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
    const forbidden = await fetch(`${store.origin}/api/settings/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation: "learning-decide",
        repositoryId: 2001,
        learningId: "mock-learning-2",
        decision: "accept",
        digest: "mock:v1",
      }),
    })
    expect(forbidden.status).toBe(403)
    expect(
      store.settings
        .getWorkspace(settingsQuerySchema.parse({ repositoryId: 2001 }))
        .learnings.find((item) => item.id === "mock-learning-2"),
    ).toMatchObject({ state: "suggested", version: 1 })
  })

  it("keeps inbox read state when opening its real seeded conversation and returning", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const server = setupServer(...createMockHandlers(store))
    const router = await renderHubFlow(server, "/notifications", { workspaceRoutes })
    const message = within(screen.getByRole("region", { name: "Inbox" })).getByRole("link", {
      name: /A visible label would make this field easier to use\./,
    })
    const row = message.closest("li")
    if (!row) throw new Error("An inbox item must have its own read-state control.")
    await router.settle(() =>
      fireEvent.click(within(row).getByRole("button", { name: "Mark as read: mona" })),
    )
    expect(within(row).getByRole("button", { name: "Mark as unread: mona" })).toBeEnabled()

    await router.settle(() => fireEvent.click(within(row).getByRole("link")))

    const conversation = screen.getByRole("dialog", { name: "Conversation" })
    expect(
      within(conversation).getByText("Could we make the welcome heading clearer?"),
    ).toBeVisible()
    expect(new URLSearchParams(router.state.location.search).get("build")).toBe("3")
    expect(new URLSearchParams(router.state.location.search).get("comment")).toBe("1")
    await router.go(-1)
    const returned = within(screen.getByRole("region", { name: "Inbox" })).getByRole("link", {
      name: /A visible label would make this field easier to use\./,
    })
    const returnedRow = returned.closest("li")
    if (!returnedRow) throw new Error("The returned inbox item must retain its controls.")
    expect(within(returnedRow).getByRole("button", { name: "Mark as unread: mona" })).toBeEnabled()
  })

  it("abandons a delayed Welcome dismissal without changing either viewer's saved navigation", async () => {
    const store = createMockStore({ origin: window.location.origin })
    const initiatingRevision = store.session.read().revision
    const server = setupServer(...createMockHandlers(store))
    const mutationStarted = vi.fn()
    server.events.on("request:start", ({ request }) => {
      if (request.method === "POST" && new URL(request.url).pathname === "/api/settings/actions") {
        mutationStarted()
      }
    })
    const router = await renderHubFlow(server, "/welcome?mockScenario=loading", { workspaceRoutes })
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
    const readerForm = new FormData()
    readerForm.set("profile", "reader")

    await act(async () =>
      router.fetch("reader-profile", "root", "/session", {
        formMethod: "post",
        formData: readerForm,
      }),
    )
    await screen.findByRole("button", { name: "Account menu for @mona" })
    await new Promise((resolve) => window.setTimeout(resolve, 1600))
    const queuedWrite = await nativeFetch(`${store.origin}/api/settings/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Replica-Mock-Session-Revision": String(initiatingRevision),
      },
      body: JSON.stringify({ operation: "welcome-hide" }),
    })
    expect(queuedWrite.status).toBe(409)
    const readerHidden = store.settings.getNavigationState().welcomeHidden
    const ownerForm = new FormData()
    ownerForm.set("profile", "owner")
    await act(async () =>
      router.fetch("owner-profile", "root", "/session", {
        formMethod: "post",
        formData: ownerForm,
      }),
    )
    await screen.findByRole("button", { name: "Account menu for @octocat" })

    expect({
      reader: readerHidden,
      owner: store.settings.getNavigationState().welcomeHidden,
    }).toEqual({ reader: false, owner: false })
  }, 15_000)

  it.each(["/settings/learnings?repositoryId=2001", "/settings/sessions"])(
    "signs out through the retained settings control at %s",
    async (path) => {
      const store = createMockStore({ origin: window.location.origin })
      const server = setupServer(...createMockHandlers(store))
      const router = await renderHubFlow(server, path, { workspaceRoutes, publicRoutes })
      if (path === "/settings/sessions") {
        fireEvent.click(await screen.findByRole("button", { name: "Sign out of mock session" }))
      } else {
        fireEvent.click(await screen.findByRole("button", { name: "Account menu for @octocat" }))
        fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))
      }
      await router.settle()

      expect(
        await screen.findByRole("button", { name: "Mock sign in as Octocat" }),
      ).toBeInTheDocument()
      expect(router.state.location.pathname).toBe("/sign-in")
      expect(store.session.read().viewer).toBeNull()
      expect(screen.queryByText("Choose a known mock profile.")).not.toBeInTheDocument()
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
        name: "I understand this ends only the current mock browser session.",
      }),
    )
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "End mock browser session" })),
    )

    expect(
      await screen.findByRole("heading", { name: "Mock browser session ended" }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/settings/sessions")
    expect(store.session.read().viewer).toBeNull()
    expect(privateReads).not.toHaveBeenCalled()
    expect(store.product.getPublicShare("demo-active").state).toBe("active")
    expect(
      screen.queryByRole("button", { name: "End mock browser session" }),
    ).not.toBeInTheDocument()
  })
})
