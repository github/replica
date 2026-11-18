import { http, HttpResponse } from "msw"
import { z } from "zod"

import { settingsOperationSchema, settingsQuerySchema } from "@application/hub/settings-contracts"
import { githubSettingKeySchema } from "@application/hub/github-setup-contracts"
import { bootstrapSecretHeader } from "@application/hub/requests/get-github-setup-status"

import type { MockSession } from "../create-mock-session/types"
import type { createSettingsStore } from "../create-settings-store"
import { mockDiagnostics } from "../diagnostics"
import { parseMockQuery } from "../parse-mock-query"
import { readMockJson } from "../read-mock-json"
import { respondMock } from "../respond-mock"
import { MockStoreError } from "../store-error"

/** Synthetic bootstrap secret accepted by the mock GitHub setup endpoints. */
export const mockBootstrapSecret = "replica-mock-bootstrap"

const githubSettingKeys = githubSettingKeySchema.options

export function createSettingsHandlers(
  store: ReturnType<typeof createSettingsStore>,
  origin: string,
  session?: MockSession,
) {
  function api(path: string) {
    return new URL(`/api/settings${path}`, origin).href
  }

  function githubSetupDenial(request: Request) {
    if (session?.read().capabilities.administerHub) return null
    const secret = request.headers.get(bootstrapSecretHeader)
    if (secret === mockBootstrapSecret) return null
    const requires = session?.read().viewer && !secret ? "administrator" : "bootstrap"
    return HttpResponse.json(
      {
        error:
          requires === "bootstrap"
            ? "Enter the bootstrap secret to view GitHub setup."
            : "Administrator access is required.",
        requires,
      },
      { status: 403 },
    )
  }

  function query(request: Request) {
    return parseMockQuery(request.url, settingsQuerySchema, "Invalid settings filters.")
  }

  return [
    ...["/api/notifications/inbox", "/notifications/inbox"].map((path) =>
      http.get(new URL(path, origin).href, ({ request }) =>
        respondMock(
          request,
          (scenario) => {
            const parsed = z
              .object({
                unread: z.enum(["true", "false"]).default("false"),
                limit: z.coerce.number().int().min(1).max(50).default(50),
                before: z.coerce.number().int().positive().optional(),
              })
              .safeParse(Object.fromEntries(new URL(request.url).searchParams))
            if (!parsed.success) throw new MockStoreError(400, "Invalid inbox filters.")
            const result = store.getNotificationPage(
              parsed.data.unread === "true",
              parsed.data.limit,
              parsed.data.before,
            )
            return HttpResponse.json(
              scenario === "empty"
                ? { notifications: [], unreadCount: 0, nextBefore: null }
                : result,
            )
          },
          session,
        ),
      ),
    ),
    http.patch(new URL("/notifications/:notificationId", origin).href, ({ request, params }) =>
      respondMock(
        request,
        async (_scenario, assertActive) => {
          const id = z.coerce.number().int().positive().safeParse(params.notificationId)
          if (!id.success) throw new MockStoreError(400, "Invalid notification identifier.")
          const input = await readMockJson(
            request,
            z.object({
              notification: z.object({
                read: z.boolean(),
                version: z.number().int().nonnegative(),
              }),
            }),
          )
          assertActive()
          store.mutate({
            operation: "notification-read",
            notificationId: id.data,
            ...input.notification,
          })
          return HttpResponse.json(store.getNotificationRead(id.data))
        },
        session,
      ),
    ),
    http.get(api("/workspace"), ({ request }) =>
      respondMock(
        request,
        (scenario) => HttpResponse.json(store.getWorkspace(query(request), scenario)),
        session,
      ),
    ),
    http.get(api("/public"), ({ request }) =>
      respondMock(request, () => HttpResponse.json(store.getPublic()), session),
    ),
    http.get(api("/github/status"), ({ request }) =>
      respondMock(
        request,
        () =>
          githubSetupDenial(request) ??
          HttpResponse.json({
            status: "configured",
            signInEnabled: true,
            settings: githubSettingKeys.map((key) => ({ key, state: "present" })),
            connectedRepositories: ["octo/checkout-flow", "octo/design-review"],
            urls: {
              homepage: origin,
              callback: new URL("/api/auth/github/callback", origin).href,
              setup: new URL("/settings/github/setup?step=install", origin).href,
              webhook: new URL("/api/github/webhooks", origin).href,
            },
          }),
        session,
      ),
    ),
    http.post(api("/github/test"), ({ request }) =>
      respondMock(
        request,
        () =>
          githubSetupDenial(request) ??
          HttpResponse.json({
            checks: [
              { name: "private_key", result: "pass", detail: "The private key is valid." },
              { name: "app_identity", result: "pass", detail: "GitHub accepted the App identity." },
              {
                name: "installation",
                result: "pass",
                detail: "The installation is active.",
                settingsUrl: "https://github.com/organizations/octo/settings/installations/123",
              },
              {
                name: "repositories",
                result: "pass",
                detail: "Hub can read 2 repositories: octo/checkout-flow, octo/design-review.",
              },
            ],
          }),
        session,
      ),
    ),
    http.get(api("/admin-candidates"), ({ request }) =>
      respondMock(
        request,
        (scenario) => {
          const result = store.searchAdministrators(query(request).q)
          return HttpResponse.json(scenario === "empty" ? { users: [], more: false } : result)
        },
        session,
      ),
    ),
    http.post(api("/actions"), ({ request }) =>
      respondMock(
        request,
        async (_scenario, assertCurrentSession) => {
          const input = await readMockJson(request, settingsOperationSchema)
          assertCurrentSession()
          try {
            return HttpResponse.json(store.mutate(input))
          } catch (error) {
            if (
              error instanceof MockStoreError &&
              error.status === 501 &&
              (input.operation === "admin-add" || input.operation === "admin-change")
            ) {
              const operation =
                input.operation === "admin-change"
                  ? `${input.operation}:${input.change}`
                  : input.operation
              mockDiagnostics.report(`${operation}; 501 Not Implemented.`)
            }
            throw error
          }
        },
        session,
      ),
    ),
  ]
}
