import type { RouteConfigEntry } from "@react-router/dev/routes"
import { act, fireEvent, render, screen } from "@testing-library/react"
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

import { navigateToExternalUrl } from "@application/hub/navigate-to-external-url"

vi.mock("@application/hub/navigate-to-external-url", () => ({
  navigateToExternalUrl: vi.fn(),
}))

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

const authorizationId = "22222222-2222-4222-8222-222222222222"

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

function session() {
  return {
    authenticated: true,
    membershipId: "11111111-1111-4111-8111-111111111111",
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    provider: "github",
    login: "octocat",
    name: "The Octocat",
    role: "ADMINISTRATOR",
  }
}

function status() {
  return {
    status: {
      activeSessionCount: 3,
      pendingAuthenticationCount: 2,
      pendingSensitiveAuthorizationCount: 1,
      revision: 4,
    },
  }
}

async function renderApplication(path: string, handlers: Parameters<typeof setupServer>) {
  vi.stubEnv("MODE", "development")
  vi.stubEnv("DEV", true)
  const requests: string[] = []
  const server = setupServer(...handlers)
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url)
    requests.push(`${request.method} ${url.pathname}${url.search}`)
  })
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
  return { requests }
}

function authenticatedSession() {
  return http.get(`${window.location.origin}/api/auth/session`, () => HttpResponse.json(session()))
}

function submitWith(button: HTMLButtonElement) {
  const form = button.form
  if (!form) throw new Error("Submit button must belong to a form.")
  form.dispatchEvent(
    new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: button,
    }),
  )
}

describe("real session revocation frontend integration", () => {
  it("shows current authentication counts before provider verification", async () => {
    const { requests } = await renderApplication("/settings/sessions", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
    ])

    expect(await screen.findByText(/3 active browser sessions/)).toBeVisible()
    expect(screen.getByText(/2 in-flight sign-ins/)).toBeVisible()
    expect(screen.getByText(/1 pending sensitive authorization/)).toBeVisible()
    expect(requests.some((request) => request.includes("/api/settings"))).toBe(false)
  })

  it("starts provider-neutral authorization only after explicit confirmation", async () => {
    let submittedBody: unknown
    await renderApplication("/settings/sessions", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.post(
        `${window.location.origin}/api/session-revocation/authorizations/start`,
        async ({ request }) => {
          submittedBody = await request.json()
          return HttpResponse.json({
            authorizationId,
            authorizationUrl: "https://github.com/login/oauth/authorize?state=opaque",
            expiresAt: "2026-11-12T17:00:00.000Z",
          })
        },
      ),
    ])

    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }))

    await vi.waitFor(() => {
      expect(submittedBody).toEqual({ confirmed: true })
      expect(navigateToExternalUrl).toHaveBeenCalledWith(
        "https://github.com/login/oauth/authorize?state=opaque",
      )
    })
  })

  it("explains how to recover when authorization start is denied", async () => {
    await renderApplication("/settings/sessions", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.post(`${window.location.origin}/api/session-revocation/authorizations/start`, () =>
        HttpResponse.json({ error: "not_authorized" }, { status: 403 }),
      ),
    ])

    fireEvent.click(await screen.findByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }))

    expect(await screen.findByText("Your account is no longer a Hub administrator.")).toBeVisible()
  })

  it("cancels before verification without starting authorization", async () => {
    const starts = vi.fn()
    await renderApplication("/settings/sessions", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.post(`${window.location.origin}/api/session-revocation/authorizations/start`, starts),
    ])

    submitWith(await screen.findByRole("button", { name: "Cancel" }))

    expect(
      await screen.findByText("Session revocation was cancelled. No sessions ended."),
    ).toBeVisible()
    expect(starts).not.toHaveBeenCalled()
  })

  it("does not intercept native sign-out before verification", async () => {
    const starts = vi.fn()
    await renderApplication("/settings/sessions", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.post(`${window.location.origin}/api/session-revocation/authorizations/start`, starts),
    ])
    const signOutForm = document.querySelector<HTMLFormElement>(
      'form[action="/api/auth/session/sign-out"]',
    )
    if (!signOutForm) throw new Error("Sign out must belong to a form.")

    expect(fireEvent.submit(signOutForm)).toBe(true)
    expect(starts).not.toHaveBeenCalled()
  })

  it("continues the verified operation and keeps the signed-out result visible", async () => {
    let continued = false
    const { requests } = await renderApplication(
      `/settings/sessions/confirm?authorizationId=${authorizationId}`,
      [
        authenticatedSession(),
        http.get(`${window.location.origin}/api/session-revocation`, () =>
          HttpResponse.json(status()),
        ),
        http.get(
          `${window.location.origin}/api/session-revocation/authorizations/${authorizationId}`,
          () =>
            HttpResponse.json({
              authorization: {
                expiresAt: "2026-11-12T17:00:00.000Z",
                operation: "END_ALL_HUB_SESSIONS",
                verifiedAt: "2026-11-12T16:55:00.000Z",
              },
            }),
        ),
        http.post(
          `${window.location.origin}/api/session-revocation/authorizations/continue`,
          () => {
            continued = true
            return HttpResponse.json({
              result: {
                cancelledAuthorizationCount: 1,
                endedSessionCount: 3,
                revision: 5,
              },
            })
          },
        ),
      ],
    )

    fireEvent.click(await screen.findByRole("button", { name: "End all sessions now" }))

    expect(
      await screen.findByRole("heading", { name: "All existing Hub sessions ended" }),
    ).toBeVisible()
    expect(continued).toBe(true)
    expect(requests.filter((request) => request === "GET /api/auth/session")).toHaveLength(2)
  })

  it("cancels verified authorization without continuing revocation", async () => {
    const cancellations: unknown[] = []
    const continuations = vi.fn()
    await renderApplication(`/settings/sessions/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.get(
        `${window.location.origin}/api/session-revocation/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              expiresAt: "2026-11-12T17:00:00.000Z",
              operation: "END_ALL_HUB_SESSIONS",
              verifiedAt: "2026-11-12T16:55:00.000Z",
            },
          }),
      ),
      http.post(
        `${window.location.origin}/api/session-revocation/authorizations/cancel`,
        async ({ request }) => {
          cancellations.push(await request.json())
          return new HttpResponse(null, { status: 204 })
        },
      ),
      http.post(
        `${window.location.origin}/api/session-revocation/authorizations/continue`,
        continuations,
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }))

    await vi.waitFor(() => expect(cancellations).toEqual([{ authorizationId }]))
    expect(
      await screen.findByText("Session revocation was cancelled. No sessions ended."),
    ).toBeVisible()
    expect(continuations).not.toHaveBeenCalled()
  })

  it("explains how to recover when verified authorization expires", async () => {
    await renderApplication(`/settings/sessions/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.get(
        `${window.location.origin}/api/session-revocation/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              expiresAt: "2026-11-12T17:00:00.000Z",
              operation: "END_ALL_HUB_SESSIONS",
              verifiedAt: "2026-11-12T16:55:00.000Z",
            },
          }),
      ),
      http.post(`${window.location.origin}/api/session-revocation/authorizations/continue`, () =>
        HttpResponse.json({ error: "expired" }, { status: 409 }),
      ),
    ])

    fireEvent.click(await screen.findByRole("button", { name: "End all sessions now" }))

    expect(
      await screen.findByText("This authorization expired. Start the session revocation again."),
    ).toBeVisible()
  })

  it("does not intercept native sign-out after verification", async () => {
    const continuations = vi.fn()
    await renderApplication(`/settings/sessions/confirm?authorizationId=${authorizationId}`, [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/session-revocation`, () =>
        HttpResponse.json(status()),
      ),
      http.get(
        `${window.location.origin}/api/session-revocation/authorizations/${authorizationId}`,
        () =>
          HttpResponse.json({
            authorization: {
              expiresAt: "2026-11-12T17:00:00.000Z",
              operation: "END_ALL_HUB_SESSIONS",
              verifiedAt: "2026-11-12T16:55:00.000Z",
            },
          }),
      ),
      http.post(
        `${window.location.origin}/api/session-revocation/authorizations/continue`,
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
})
