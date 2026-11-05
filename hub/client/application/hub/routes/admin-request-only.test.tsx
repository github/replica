import { fireEvent, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { useLoaderData, type RouteObject } from "react-router"
import { describe, expect, it, onTestFinished } from "vitest"

import { createMockHandlers } from "../mocks/create-handlers"
import { createMockStore } from "../mocks/create-store"
import { mockDiagnostics } from "../mocks/diagnostics"
import { settingsQuerySchema } from "../settings-contracts"
import type { SettingsOperation } from "../settings-contracts"
import SettingsAdminConfirmationRoute, {
  clientAction as confirmAdministrator,
  clientLoader as loadConfirmation,
} from "./settings-admin-confirmation"
import SettingsAdminsRoute, {
  clientAction as addAdministrators,
  clientLoader as loadAdministrators,
} from "./settings-admins"
import { renderHubFlow } from "./test-fixture"

function AdministratorsComponent() {
  return <SettingsAdminsRoute loaderData={useLoaderData<typeof loadAdministrators>()} />
}

function ConfirmationComponent() {
  return <SettingsAdminConfirmationRoute loaderData={useLoaderData<typeof loadConfirmation>()} />
}

function unavailableServerRoute(): Promise<never> {
  return Promise.reject(new Error("The mock frontend must not call a server route."))
}

const workspaceRoutes: RouteObject[] = [
  {
    path: "/settings/admins",
    loader: (args) => loadAdministrators({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => addAdministrators({ ...args, serverAction: unavailableServerRoute }),
    Component: AdministratorsComponent,
  },
  {
    path: "/settings/admins/:userId/:operation",
    loader: (args) => loadConfirmation({ ...args, serverLoader: unavailableServerRoute }),
    action: (args) => confirmAdministrator({ ...args, serverAction: unavailableServerRoute }),
    Component: ConfirmationComponent,
  },
]

function observeActions(server: ReturnType<typeof setupServer>) {
  const inputs: Promise<unknown>[] = []
  const responses: { status: number; contentType: string | null; body: Promise<unknown> }[] = []
  server.events.on("request:start", ({ request }) => {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/settings/actions") {
      inputs.push(request.clone().json())
    }
  })
  server.events.on("response:mocked", ({ request, response }) => {
    if (request.method === "POST" && new URL(request.url).pathname === "/api/settings/actions") {
      responses.push({
        status: response.status,
        contentType: response.headers.get("Content-Type"),
        body: response.clone().json(),
      })
    }
  })
  return { inputs, responses }
}

async function expectUnavailableAttempt(
  attempts: ReturnType<typeof observeActions>,
  input: SettingsOperation,
) {
  expect(await Promise.all(attempts.inputs)).toEqual([input])
  expect(attempts.responses).toHaveLength(1)
  const response = attempts.responses[0]
  if (!response) throw new Error("The confirmed administrator action must receive a response.")
  expect(response.status).toBe(501)
  expect(response.contentType).toContain("application/json")
  expect(await response.body).toHaveProperty("error")
  expect(screen.getByRole("alert")).toBeVisible()
  expect(screen.getByRole("alert")).toHaveTextContent(/unavailable|not implemented|not available/i)
  const toolbar = screen.getByRole("complementary", { name: "Frontend test controls" })
  expect(within(toolbar).getByRole("status")).toHaveTextContent(/not.implemented/i)
  expect(within(toolbar).getByRole("status")).toHaveTextContent(/501/)
  expect(within(toolbar).getByRole("status")).toHaveTextContent(input.operation)
}

describe("Hub administrator request-only flows", () => {
  it("sends a confirmed Mona addition without changing administrators or recording success", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    onTestFinished(() => mockDiagnostics.clear())
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const query = settingsQuerySchema.parse({ scope: "hub" })
    const before = store.settings.getWorkspace(query)
    const server = setupServer(...createMockHandlers(store))
    const attempts = observeActions(server)
    const router = await renderHubFlow(server, "/settings/admins", {
      workspaceRoutes,
      withTools: true,
    })

    fireEvent.click(screen.getByRole("button", { name: "Add administrator" }))
    const dialog = screen.getByRole("dialog", { name: "Add administrator" })
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /@mona$/ }))
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I confirm adding the selected users as Hub administrators.",
      }),
    )
    await router.settle(() =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Add selected administrators" })),
    )

    await expectUnavailableAttempt(attempts, {
      operation: "admin-add",
      userIds: [2],
      confirmed: true,
    })
    expect(store.settings.getWorkspace(query)).toEqual(before)
    expect(screen.getByRole("heading", { name: "1 administrator" })).toBeVisible()
    expect(
      within(dialog).getByRole("button", { name: "Add selected administrators" }),
    ).toBeEnabled()
    expect(within(dialog).getByRole("searchbox")).toBeEnabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add administrator" })).toBeEnabled()
  }, 15_000)

  it("sends a confirmed designation without changing the target's role, capabilities or audit", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    onTestFinished(() => mockDiagnostics.clear())
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const query = settingsQuerySchema.parse({ scope: "hub" })
    const before = store.settings.getWorkspace(query)
    const server = setupServer(...createMockHandlers(store))
    const attempts = observeActions(server)
    const router = await renderHubFlow(server, "/settings/admins/2/designate", {
      workspaceRoutes,
      withTools: true,
    })

    fireEvent.click(
      screen.getByRole("checkbox", { name: "I confirm this Hub administrator role change." }),
    )
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Designate administrator" })),
    )

    await expectUnavailableAttempt(attempts, {
      operation: "admin-change",
      userId: 2,
      change: "designate",
      confirmed: true,
    })
    expect(store.settings.getWorkspace(query)).toEqual(before)
    expect(router.state.location.pathname).toBe("/settings/admins/2/designate")
    expect(screen.getByRole("button", { name: "Designate administrator" })).toBeEnabled()
    expect(screen.getByRole("checkbox")).toBeEnabled()
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Cancel" })))
    expect(screen.getByRole("heading", { name: "1 administrator" })).toBeVisible()
  }, 15_000)

  it("uses an API-supplied administrator identity and sends its arbitrary revoke target without changing state", async () => {
    mockDiagnostics.initialize()
    mockDiagnostics.clear()
    onTestFinished(() => mockDiagnostics.clear())
    const store = createMockStore({ origin: window.location.origin })
    store.session.select("admin")
    const query = settingsQuerySchema.parse({ scope: "hub" })
    const before = store.settings.getWorkspace(query)
    const target = { id: 73, login: "cedar-moth", name: "Cedar Moth" }
    const server = setupServer(
      http.get(new URL("/api/settings/workspace", store.origin).href, ({ request }) => {
        const state = store.settings.getWorkspace(
          settingsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams)),
        )
        return HttpResponse.json({
          ...state,
          administrators: {
            ...state.administrators,
            users: [...state.administrators.users, target],
          },
        })
      }),
      ...createMockHandlers(store),
    )
    const attempts = observeActions(server)
    const router = await renderHubFlow(server, "/settings/admins", {
      workspaceRoutes,
      withTools: true,
    })
    const row = screen.getByText("@cedar-moth").closest("li")
    if (!row) throw new Error("The API-supplied administrator must have a roster entry.")
    await router.settle(() =>
      fireEvent.click(within(row).getByRole("link", { name: "Remove administrator" })),
    )

    const identity = screen.getByRole("region", { name: target.login })
    expect(within(identity).getByText(target.name)).toBeVisible()
    expect(within(identity).getByText(`@${target.login}`)).toBeVisible()
    expect(identity).toHaveTextContent("Hub user 73")
    fireEvent.click(
      screen.getByRole("checkbox", { name: "I confirm this Hub administrator role change." }),
    )
    await router.settle(() =>
      fireEvent.click(screen.getByRole("button", { name: "Remove administrator" })),
    )

    await expectUnavailableAttempt(attempts, {
      operation: "admin-change",
      userId: 73,
      change: "revoke",
      confirmed: true,
    })
    expect(store.settings.getWorkspace(query)).toEqual(before)
    expect(screen.getByRole("button", { name: "Remove administrator" })).toBeEnabled()
    expect(screen.getByRole("checkbox")).toBeEnabled()
    await router.settle(() => fireEvent.click(screen.getByRole("link", { name: "Cancel" })))
    expect(screen.getByRole("heading", { name: "2 administrators" })).toBeVisible()
    expect(screen.getByText("@cedar-moth")).toBeVisible()
  }, 15_000)
})
