import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
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
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Mona Lisa @mona" }))
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
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Mona Lisa @mona" }))
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
        HttpResponse.json(
          { error: "The session authentication provider is unavailable." },
          { status: 409 },
        ),
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Add administrator" }))
    const dialog = screen.getByRole("dialog", { name: "Add administrator" })
    fireEvent.change(within(dialog).getByRole("searchbox"), {
      target: { value: "mona" },
    })
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Mona Lisa @mona" }))
    fireEvent.click(
      within(dialog).getByRole("checkbox", {
        name: "I confirm adding the selected users as Hub administrators.",
      }),
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Add selected administrators" }))

    expect(
      await screen.findByText("The session authentication provider is unavailable."),
    ).toBeVisible()
    expect(navigateToExternalUrl).not.toHaveBeenCalled()
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
          return HttpResponse.json({
            authenticated: true,
            membershipId: actorMembershipId,
            userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            provider: "github",
            login: "octocat",
            name: "The Octocat",
            role: continued ? "MEMBER" : "ADMINISTRATOR",
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
            return HttpResponse.json({ result: { changed: true } })
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
    expect(screen.getByRole("status")).toHaveTextContent(/administrator.*removed/i)
    expect(screen.queryByRole("link", { name: "Hub administrators" })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/settings/administrators/confirm")
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
