import { http, HttpResponse } from "msw"

import { settingsOperationSchema, settingsQuerySchema } from "../../settings-contracts"
import type { MockSession } from "../create-session"
import type { createSettingsStore } from "../create-settings-store"
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
    if (!parsed.success) throw new MockStoreError(400, "Invalid mock settings filters.")
    return parsed.data
  }

  return [
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
          return HttpResponse.json(store.mutate(input))
        },
        session,
      ),
    ),
  ]
}
