import { act, render, screen } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { setupServer } from "msw/node"
import { createBrowserRouter, RouterProvider, useLoaderData } from "react-router"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import type { RepositoryRecord } from "@application/hub/contracts/types"
import { HubThemeProvider } from "@hooks/use-hub-theme"

import HubRoot, { clientLoader as loadHub, ErrorBoundary, HydrateFallback } from "../root"

import SecurityAudit, {
  clientAction as changeAudit,
  clientLoader as loadAudit,
} from "./settings-audit"
import Workspace, { clientLoader as loadWorkspace } from "./workspace"

const membershipId = "11111111-1111-4111-8111-111111111111"

function session(role = "ADMINISTRATOR") {
  return {
    authenticated: true,
    membershipId,
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    provider: "github",
    login: "octocat",
    name: "The Octocat",
    role,
  }
}

function unavailableServerRoute(): Promise<never> {
  return Promise.reject(new Error("The audit frontend must use the audit API directly."))
}

async function renderApplication(
  path: string,
  handlers: Parameters<typeof setupServer>,
  repositories: RepositoryRecord[] = [],
) {
  vi.stubEnv("MODE", "development")
  vi.stubEnv("DEV", true)
  const requests: string[] = []
  const { userId, provider, login, name } = session()
  const server = setupServer(
    ...handlers,
    http.get(`${window.location.origin}/api/workspace`, () =>
      HttpResponse.json({
        viewer: { id: userId, provider, login, name, avatarUrl: null },
        repositories,
        capabilities: {
          createPrototypes: false,
          reviewPrototypes: false,
          manageSharing: false,
          administerHub: true,
        },
      }),
    ),
  )
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url)
    requests.push(`${request.method} ${url.pathname}${url.search}`)
  })
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
  window.history.replaceState(null, "", path)
  const router = createBrowserRouter(
    [
      {
        id: "root",
        loader: loadHub,
        Component: () => <HubRoot loaderData={useLoaderData<typeof loadHub>()} />,
        ErrorBoundary,
        HydrateFallback,
        children: [
          {
            id: "routes/workspace/index",
            loader: loadWorkspace,
            Component: () => <Workspace loaderData={useLoaderData<typeof loadWorkspace>()} />,
            children: [
              {
                path: "settings/audit",
                loader: (args) => loadAudit({ ...args, serverLoader: unavailableServerRoute }),
                action: (args) => changeAudit({ ...args, serverAction: unavailableServerRoute }),
                Component: () => <SecurityAudit loaderData={useLoaderData<typeof loadAudit>()} />,
              },
            ],
          },
        ],
      },
    ],
    { window },
  )
  onTestFinished(() => router.dispose())
  await vi.waitFor(() => expect(router.state.initialized).toBe(true), { timeout: 10_000 })
  render(
    <HubThemeProvider>
      <RouterProvider router={router} />
    </HubThemeProvider>,
  )
  return { requests, router }
}

function authenticatedSession() {
  return http.get(`${window.location.origin}/api/auth/session`, () => HttpResponse.json(session()))
}

function expectOnlyRealAuditRequests(requests: string[]) {
  const allowed = ["GET /api/auth/session", "GET /api/workspace", "GET /api/security-audits"]
  expect(requests.filter((request) => !allowed.includes(request.split("?")[0] ?? request))).toEqual(
    [],
  )
}

describe("real security audit frontend integration", () => {
  it("keeps a repository hint separate from Hub audit scope and preserves opaque pagination", async () => {
    const before = "current+/cursor=="
    const nextCursor = "next+/cursor=="
    const repositoryId = "33333333-3333-4333-8333-333333333333"
    const { requests } = await renderApplication(
      `/settings/audit?scope=hub&repositoryId=${repositoryId}&before=${encodeURIComponent(before)}`,
      [
        authenticatedSession(),
        http.get(`${window.location.origin}/api/security-audits`, () =>
          HttpResponse.json({
            records: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                occurredAt: "2026-11-10T12:00:00.000Z",
                action: "unknown.future.action",
                outcome: null,
                actor: null,
                context: {},
              },
            ],
            nextCursor,
          }),
        ),
      ],
      [
        {
          id: repositoryId,
          nameWithOwner: "team/design",
          defaultBranch: "main",
          capabilities: {
            reviewPrototypes: true,
            manageSharing: false,
            administerRepository: true,
          },
        },
      ],
    )

    expect(await screen.findByText("unknown.future.action")).toBeVisible()
    expect(requests.filter((request) => request.includes("/api/security-audits"))).toEqual([
      `GET /api/security-audits?limit=50&before=${encodeURIComponent(before)}`,
    ])
    expectOnlyRealAuditRequests(requests)
    const older = new URL(
      screen.getByRole<HTMLAnchorElement>("link", { name: "Older actions" }).href,
    )
    expect(older.pathname).toBe("/settings/audit")
    expect(Object.fromEntries(older.searchParams)).toEqual({
      scope: "hub",
      repositoryId,
      before: nextCursor,
    })
  })

  it("accepts and renders the safe Copilot credential provider field", async () => {
    await renderApplication("/settings/audit?scope=hub", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/security-audits`, () =>
        HttpResponse.json({
          records: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              occurredAt: "2026-11-10T12:00:00.000Z",
              action: "copilot.connection.connected",
              outcome: "success",
              actor: { membershipId },
              context: {
                provider: "environment_token",
                phase: "connected",
              },
            },
          ],
          nextCursor: null,
        }),
      ),
    ])

    expect(await screen.findByText("environment_token")).toBeVisible()
    expect(screen.getByText("Provider")).toBeVisible()
  })

  it("keeps the real Hub audit read-only without requesting product settings APIs", async () => {
    const { requests, router } = await renderApplication("/settings/audit?scope=hub", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/security-audits`, () =>
        HttpResponse.json({ records: [], nextCursor: null }),
      ),
    ])
    await screen.findByText("No Hub security actions are available.")

    await act(async () => {
      await router.navigate("/settings/audit?scope=hub", {
        formMethod: "post",
        formData: new FormData(),
      })
    })

    expect(await screen.findByText("405")).toBeVisible()
    expect(screen.getByText("The Hub security audit is read-only.")).toBeVisible()
    expectOnlyRealAuditRequests(requests)
  })

  it.each([
    ["an unsupported query field", "/settings/audit?scope=hub&page=2", null],
    [
      "repository scope without a repository",
      "/settings/audit?scope=repository",
      "Select a valid security audit scope.",
    ],
    ["an empty cursor", "/settings/audit?scope=hub&before=", null],
    ["repeated cursors", "/settings/audit?scope=hub&before=one&before=two", null],
    ["an oversized cursor", `/settings/audit?scope=hub&before=${"a".repeat(501)}`, null],
  ])("shows a 400 error for %s before loading audit data", async (_label, path, message) => {
    const { requests } = await renderApplication(path, [authenticatedSession()])

    expect(await screen.findByRole("heading", { name: "Invalid address" })).toBeVisible()
    expect(screen.getByText("400")).toBeVisible()
    if (message) expect(screen.getByText(message)).toBeVisible()
    expect(requests.some((request) => request.includes("/api/security-audits"))).toBe(false)
    expectOnlyRealAuditRequests(requests)
  })

  it("requires a current administrator session before loading audit data", async () => {
    const { requests } = await renderApplication("/settings/audit?scope=hub", [
      http.get(`${window.location.origin}/api/auth/session`, () =>
        HttpResponse.json(session("MEMBER")),
      ),
    ])

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeVisible()
    expect(screen.getByText("Administrator access is required.")).toBeVisible()
    expect(requests.some((request) => request.includes("/api/security-audits"))).toBe(false)
    expectOnlyRealAuditRequests(requests)
  })

  it.each([
    {
      label: "an API failure",
      response: () => HttpResponse.json({ error: "Security audit unavailable." }, { status: 503 }),
      message: "Security audit unavailable.",
    },
    {
      label: "malformed JSON",
      response: () =>
        new HttpResponse("{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      message: "The API returned invalid JSON.",
    },
    {
      label: "a malformed response",
      response: () => HttpResponse.json({ records: "not-an-array", nextCursor: null }),
      message: "The API returned data in an unexpected shape.",
    },
    {
      label: "a network failure",
      response: () => HttpResponse.error(),
      message: "Unable to reach the Hub API.",
    },
  ])("keeps $label visible without mock fallback", async ({ response, message }) => {
    const { requests } = await renderApplication("/settings/audit?scope=hub", [
      authenticatedSession(),
      http.get(`${window.location.origin}/api/security-audits`, response),
    ])

    expect(await screen.findByText(message)).toBeVisible()
    expectOnlyRealAuditRequests(requests)
  })

  it("rereads the session after an audit 403 and reports lost administrator access", async () => {
    let auditDenied = false
    let refreshedSessionRequests = 0
    await renderApplication("/settings/audit?scope=hub", [
      http.get(`${window.location.origin}/api/auth/session`, () => {
        if (!auditDenied) return HttpResponse.json(session())
        refreshedSessionRequests += 1
        return HttpResponse.json(session("MEMBER"))
      }),
      http.get(`${window.location.origin}/api/security-audits`, () => {
        auditDenied = true
        return HttpResponse.json({ error: "forbidden" }, { status: 403 })
      }),
    ])

    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeVisible()
    expect(screen.getByText("Your account no longer has Hub administrator access.")).toBeVisible()
    expect(refreshedSessionRequests).toBe(1)
  })
})
