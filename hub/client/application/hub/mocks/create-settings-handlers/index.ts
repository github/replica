import { http, HttpResponse } from "msw"
import { z } from "zod"

import { settingsOperationSchema, settingsQuerySchema } from "@application/hub/settings-contracts"

import type { MockSession } from "../create-session/types"
import type { createSettingsStore } from "../create-settings-store"
import { mockDiagnostics } from "../diagnostics"
import { readMockJson } from "../read-json"
import { respondMock } from "../respond"
import { MockStoreError } from "../store-error"

export function createSettingsHandlers(
  store: ReturnType<typeof createSettingsStore>,
  origin: string,
  session?: MockSession,
) {
  function api(path: string) {
    return new URL(`/api/settings${path}`, origin).href
  }

  function query(request: Request) {
    const parsed = settingsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    )
    if (!parsed.success) throw new MockStoreError(400, "Invalid settings filters.")
    return parsed.data
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
              const ids = input.operation === "admin-add" ? input.userIds : [input.userId]
              mockDiagnostics.report(
                `${request.method} ${new URL(request.url).pathname}: ${operation}; target IDs: ${ids.join(", ")}; 501 Not Implemented.`,
              )
            }
            throw error
          }
        },
        session,
      ),
    ),
  ]
}
