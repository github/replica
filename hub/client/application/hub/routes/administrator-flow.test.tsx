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

const navigateToExternalUrl = vi.fn()
vi.mock("@application/hub/navigate-to-external-url", () => ({ navigateToExternalUrl }))

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

const actorMembershipId = "11111111-1111-4111-8111-111111111111"
const targetMembershipId = "22222222-2222-4222-8222-222222222222"
const authorizationId = "33333333-3333-4333-8333-333333333333"

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

async function renderApplication(path: string, handlers: Parameters<typeof setupServer>) {
  vi.stubEnv("MODE", "development")
  vi.stubEnv("DEV", true)
  const server = setupServer(...handlers)
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
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

function authenticatedSession(role = "ADMINISTRATOR") {
  return http.get(`${window.location.origin}/api/auth/session`, () =>
    HttpResponse.json({
      authenticated: true,
      membershipId: actorMembershipId,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      provider: "github",
      login: "octocat",
      name: "The Octocat",
      role,
    }),
  )
}

function administrator(login = "octocat", membershipId = actorMembershipId) {
  return {
    membershipId,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    provider: "github",
    login,
    name: login === "octocat" ? "The Octocat" : "Mona Lisa",
    createdAt: "2026-11-09T20:00:00.000Z",
  }
}

describe("administrator frontend integration", () => {
  it("uses the real Copilot status and mutation APIs with visible action results", async () => {
    const mutations: Array<{ body: unknown; method: string; path: string }> = []
    let connected = false
    await renderApplication("/settings/copilot", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/copilot-connection`, () =>
        HttpResponse.json({
          configured: true,
          connected,
          connectedBy: connected
            ? {
                login: "octocat",
                membershipId: actorMembershipId,
                name: "The Octocat",
              }
            : null,
          refusedAt: null,
          verifiedAt: connected ? "2026-11-10T23:00:00.000Z" : null,
        }),
      ),
      http.post(`${window.location.origin}/api/copilot-connection/connect`, async ({ request }) => {
        mutations.push({
          body: await request.json(),
          method: request.method,
          path: new URL(request.url).pathname,
        })
        connected = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete(`${window.location.origin}/api/copilot-connection`, async ({ request }) => {
        mutations.push({
          body: await request.json(),
          method: request.method,
          path: new URL(request.url).pathname,
        })
        return HttpResponse.json({ error: "Copilot is temporarily unavailable." }, { status: 503 })
      }),
    ])

    expect(await screen.findByRole("heading", { name: "Copilot is not connected" })).toBeVisible()
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand and confirm connecting Copilot for this Hub.",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Connect Copilot" }))

    expect(await screen.findByText("Copilot connected.")).toBeVisible()
    expect(await screen.findByRole("heading", { name: "Copilot is connected" })).toBeVisible()
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand and confirm disconnecting Copilot for this Hub.",
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Copilot" }))

    expect(await screen.findByText("Copilot is temporarily unavailable.")).toBeVisible()
    await waitFor(() =>
      expect(mutations).toEqual([
        {
          body: { confirmed: true },
          method: "POST",
          path: "/api/copilot-connection/connect",
        },
        {
          body: { confirmed: true },
          method: "DELETE",
          path: "/api/copilot-connection",
        },
      ]),
    )
  })

  it("uses the real administrator contract and retains its opaque cursor", async () => {
    const requests: string[] = []
    const nextCursor = "opaque+/cursor=="
    const serverHandler = http.get(
      `${window.location.origin}/api/administrators`,
      ({ request }) => {
        const url = new URL(request.url)
        requests.push(`${url.pathname}?${url.searchParams.toString()}`)
        return HttpResponse.json({
          administrators: [administrator()],
          nextCursor,
        })
      },
    )

    await renderApplication("/settings/administrators", [authenticatedSession(), serverHandler])

    expect((await screen.findAllByText("@octocat")).at(-1)).toBeVisible()
    expect(requests).toEqual(["/api/administrators?limit=50"])
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      `/settings/administrators?before=${encodeURIComponent(nextCursor)}`,
    )
  })

  it("searches candidates and preserves UUID selections without numeric coercion", async () => {
    const candidateRequests: string[] = []
    await renderApplication("/settings/administrators", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/administrators`, () =>
        HttpResponse.json({ administrators: [administrator()], nextCursor: null }),
      ),
      http.get(`${window.location.origin}/api/administrators/candidates`, ({ request }) => {
        const url = new URL(request.url)
        candidateRequests.push(`${url.pathname}?${url.searchParams.toString()}`)
        return HttpResponse.json({
          candidates: [
            {
              membershipId: targetMembershipId,
              provider: "github",
              login: "mona",
              name: "Mona Lisa",
            },
          ],
        })
      }),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Add administrator" }))
    const dialog = screen.getByRole("dialog", { name: "Add administrator" })
    fireEvent.change(within(dialog).getByRole("searchbox"), {
      target: { value: "mona" },
    })
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Mona Lisa/ }))
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I confirm adding the selected users as Hub administrators.",
      }),
    )

    expect(candidateRequests).toContain("/api/administrators/candidates?query=mona&limit=50")
    const form = within(dialog)
      .getByRole("button", { name: "Add selected administrators" })
      .closest("form")
    if (!form) throw new Error("The designation control must belong to a form.")
    expect(new FormData(form).getAll("targetMembershipIds")).toEqual([targetMembershipId])
  })

  it("starts provider authorization with JSON before leaving the application", async () => {
    const bodies: unknown[] = []
    await renderApplication("/settings/administrators", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/administrators`, () =>
        HttpResponse.json({ administrators: [administrator()], nextCursor: null }),
      ),
      http.get(`${window.location.origin}/api/administrators/candidates`, () =>
        HttpResponse.json({
          candidates: [
            {
              membershipId: targetMembershipId,
              provider: "github",
              login: "mona",
              name: "Mona Lisa",
            },
          ],
        }),
      ),
      http.post(
        `${window.location.origin}/api/administrators/authorizations/start`,
        async ({ request }) => {
          bodies.push(await request.json())
          return HttpResponse.json({
            authorizationId,
            authorizationUrl: "https://github.com/login/oauth/authorize",
            expiresAt: "2026-11-09T20:06:00.000Z",
          })
        },
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Add administrator" }))
    const dialog = screen.getByRole("dialog", { name: "Add administrator" })
    fireEvent.change(within(dialog).getByRole("searchbox"), {
      target: { value: "mona" },
    })
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Mona Lisa/ }))
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I confirm adding the selected users as Hub administrators.",
      }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Add selected administrators" }))

    await vi.waitFor(() =>
      expect(bodies).toEqual([
        {
          operation: "DESIGNATE_ADMINISTRATORS",
          targetMembershipIds: [targetMembershipId],
        },
      ]),
    )
    expect(navigateToExternalUrl).toHaveBeenCalledWith("https://github.com/login/oauth/authorize")
  })

  it("keeps an authorization-start failure visible without leaving the application", async () => {
    await renderApplication("/settings/administrators", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/administrators`, () =>
        HttpResponse.json({ administrators: [administrator()], nextCursor: null }),
      ),
      http.get(`${window.location.origin}/api/administrators/candidates`, () =>
        HttpResponse.json({
          candidates: [
            {
              membershipId: targetMembershipId,
              provider: "github",
              login: "mona",
              name: "Mona Lisa",
            },
          ],
        }),
      ),
      http.post(`${window.location.origin}/api/administrators/authorizations/start`, () =>
        HttpResponse.json({ error: "invalid_selection" }, { status: 409 }),
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Add administrator" }))
    const dialog = screen.getByRole("dialog", { name: "Add administrator" })
    fireEvent.change(within(dialog).getByRole("searchbox"), {
      target: { value: "mona" },
    })
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Mona Lisa/ }))
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I confirm adding the selected users as Hub administrators.",
      }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Add selected administrators" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /choose between one and 50 distinct hub users/i,
    )
    expect(within(dialog).getByRole("checkbox", { name: /Mona Lisa/ })).toBeChecked()
    expect(
      within(dialog).getByRole("checkbox", {
        name: "I confirm adding the selected users as Hub administrators.",
      }),
    ).toBeChecked()
    expect(navigateToExternalUrl).not.toHaveBeenCalled()
  })

  it("does not intercept sign-out from the removal confirmation page", async () => {
    const starts = vi.fn()
    await renderApplication(`/settings/administrators/${targetMembershipId}/revoke`, [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/administrators`, () =>
        HttpResponse.json({
          administrators: [administrator(), administrator("mona", targetMembershipId)],
          nextCursor: null,
        }),
      ),
      http.post(`${window.location.origin}/api/administrators/authorizations/start`, starts),
    ])

    const signOutForm = document.querySelector<HTMLFormElement>(
      'form[action="/api/auth/session/sign-out"]',
    )
    if (!signOutForm) throw new Error("Sign out must belong to a form.")

    expect(fireEvent.submit(signOutForm)).toBe(true)
    expect(starts).not.toHaveBeenCalled()
  })

  it("continues a callback confirmation with JSON and refreshes authority after self-removal", async () => {
    let sessionReads = 0
    let continued = false
    let readsBeforeContinuation = 0
    const continuationBodies: unknown[] = []
    const router = await renderApplication(
      `/settings/administrators/confirm?authorizationId=${authorizationId}`,
      [
        http.get(`${window.location.origin}/api/auth/session`, () => {
          sessionReads += 1
          if (continued) return HttpResponse.json({ authenticated: false }, { status: 401 })
          return HttpResponse.json({
            authenticated: true,
            membershipId: actorMembershipId,
            userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            provider: "github",
            login: "octocat",
            name: "The Octocat",
            role: "ADMINISTRATOR",
          })
        }),
        http.get(
          `${window.location.origin}/api/administrators/authorizations/${authorizationId}`,
          () =>
            HttpResponse.json({
              authorization: {
                operation: "REVOKE_ADMINISTRATOR",
                targets: [
                  {
                    membershipId: actorMembershipId,
                    provider: "github",
                    login: "octocat",
                    name: "The Octocat",
                  },
                ],
                verifiedAt: "2026-11-09T20:01:00.000Z",
                expiresAt: "2026-11-09T20:06:00.000Z",
              },
            }),
        ),
        http.post(
          `${window.location.origin}/api/administrators/authorizations/continue`,
          async ({ request }) => {
            continuationBodies.push(await request.json())
            readsBeforeContinuation = sessionReads
            continued = true
            return HttpResponse.json({
              result: {
                assignmentId: "44444444-4444-4444-8444-444444444444",
                membershipId: actorMembershipId,
              },
            })
          },
        ),
      ],
    )

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))

    await vi.waitFor(() => expect(continuationBodies).toHaveLength(1))
    expect(continuationBodies).toEqual([
      {
        authorizationId,
        operation: "REVOKE_ADMINISTRATOR",
        targetMembershipIds: [actorMembershipId],
      },
    ])
    await vi.waitFor(() => expect(sessionReads).toBeGreaterThan(readsBeforeContinuation))
    expect(screen.getByRole("status")).toHaveTextContent(/access was removed.*session ended/i)
    expect(screen.queryByRole("link", { name: "Hub administrators" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/settings/administrators/confirm")
  })

  it("does not intercept sign-out from the callback confirmation page", async () => {
    const continuations = vi.fn()
    await renderApplication(`/settings/administrators/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(
        `${window.location.origin}/api/administrators/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              operation: "REVOKE_ADMINISTRATOR",
              targets: [
                {
                  membershipId: targetMembershipId,
                  provider: "github",
                  login: "mona",
                  name: "Mona Lisa",
                },
              ],
              verifiedAt: "2026-11-09T20:01:00.000Z",
              expiresAt: "2026-11-09T20:06:00.000Z",
            },
          }),
      ),
      http.post(
        `${window.location.origin}/api/administrators/authorizations/continue`,
        continuations,
      ),
    ])

    const signOutForm = document.querySelector<HTMLFormElement>(
      'form[action="/api/auth/session/sign-out"]',
    )
    if (!signOutForm) throw new Error("Sign out must belong to a form.")

    expect(fireEvent.submit(signOutForm)).toBe(true)
    expect(continuations).not.toHaveBeenCalled()
  })

  it("shows the server-owned callback operation and target identity", async () => {
    await renderApplication(`/settings/administrators/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(
        `${window.location.origin}/api/administrators/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              operation: "REVOKE_ADMINISTRATOR",
              targets: [
                {
                  membershipId: targetMembershipId,
                  provider: "entra",
                  login: "mona@example.test",
                  name: "Mona Lisa",
                },
              ],
              verifiedAt: "2026-11-09T20:01:00.000Z",
              expiresAt: "2026-11-09T20:06:00.000Z",
            },
          }),
      ),
    ])

    expect(await screen.findByText(/remove hub administrator/i)).toBeVisible()
    expect(screen.getByText("Mona Lisa")).toBeVisible()
    expect(
      screen.getByText(
        /@mona@example\.test.*Microsoft Entra account.*22222222-2222-4222-8222-222222222222/i,
      ),
    ).toBeVisible()
  })

  it("cancels the callback authorization with JSON and returns to the roster", async () => {
    const cancellationBodies: unknown[] = []
    const router = await renderApplication(
      `/settings/administrators/confirm?authorizationId=${authorizationId}`,
      [
        authenticatedSession(),
        http.get(
          `${window.location.origin}/api/administrators/authorizations/${authorizationId}`,
          () =>
            HttpResponse.json({
              authorization: {
                operation: "REVOKE_ADMINISTRATOR",
                targets: [
                  {
                    membershipId: targetMembershipId,
                    provider: "github",
                    login: "mona",
                    name: "Mona Lisa",
                  },
                ],
                verifiedAt: "2026-11-09T20:01:00.000Z",
                expiresAt: "2026-11-09T20:06:00.000Z",
              },
            }),
        ),
        http.post(
          `${window.location.origin}/api/administrators/authorizations/cancel`,
          async ({ request }) => {
            cancellationBodies.push(await request.json())
            return new HttpResponse(null, { status: 204 })
          },
        ),
        http.get(`${window.location.origin}/api/administrators`, () =>
          HttpResponse.json({ administrators: [administrator()], nextCursor: null }),
        ),
      ],
    )

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))

    await vi.waitFor(() => expect(cancellationBodies).toEqual([{ authorizationId }]))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/settings/administrators"))
  })

  it("keeps a continuation conflict visible without reporting success", async () => {
    await renderApplication(`/settings/administrators/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(
        `${window.location.origin}/api/administrators/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              operation: "REVOKE_ADMINISTRATOR",
              targets: [
                {
                  membershipId: targetMembershipId,
                  provider: "github",
                  login: "mona",
                  name: "Mona Lisa",
                },
              ],
              verifiedAt: "2026-11-09T20:01:00.000Z",
              expiresAt: "2026-11-09T20:06:00.000Z",
            },
          }),
      ),
      http.post(`${window.location.origin}/api/administrators/authorizations/continue`, () =>
        HttpResponse.json(
          { error: "The authorization is stale or already used." },
          { status: 409 },
        ),
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The authorization is stale or already used.",
    )
    expect(screen.queryByText(/role changed/i)).not.toBeInTheDocument()
  })

  it.each([
    ["used", /already used.*start again/i],
    ["expired", /expired.*again/i],
    ["role_changed", /role changed.*review.*roster.*try again/i],
    ["last_administrator", /final.*administrator.*designate another/i],
  ])("translates the %s continuation reason into recovery guidance", async (reason, guidance) => {
    await renderApplication(`/settings/administrators/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(
        `${window.location.origin}/api/administrators/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              operation: "REVOKE_ADMINISTRATOR",
              targets: [
                {
                  membershipId: targetMembershipId,
                  provider: "github",
                  login: "mona",
                  name: "Mona Lisa",
                },
              ],
              verifiedAt: "2026-11-09T20:01:00.000Z",
              expiresAt: "2026-11-09T20:06:00.000Z",
            },
          }),
      ),
      http.post(`${window.location.origin}/api/administrators/authorizations/continue`, () =>
        HttpResponse.json({ error: reason }, { status: 409 }),
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Continue" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(guidance)
  })

  it.each([
    ["/settings/admins?before=opaque", "/settings/administrators?before=opaque"],
    [
      `/settings/admins/${targetMembershipId}/revoke?repositoryId=2001`,
      `/settings/administrators/${targetMembershipId}/revoke?repositoryId=2001`,
    ],
  ])("redirects %s to %s", async (legacyPath, canonicalPath) => {
    const router = await renderApplication(legacyPath, [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/administrators`, () =>
        HttpResponse.json({ administrators: [administrator()], nextCursor: null }),
      ),
    ])

    await vi.waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(canonicalPath)
    })
  })
})
