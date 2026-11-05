import { http, HttpResponse } from "msw"

import {
  prototypeDetailsSchema,
  prototypeQuerySchema,
  routeIdentifierSchema,
  routeQuerySchema,
} from "../../contracts"
import { sessionResponseSchema } from "../../session-contracts"
import type { MockStore } from "../create-store"
import { MockStoreError } from "../store-error"
import { respondMock } from "../respond"
import { createReviewHandlers } from "../create-review-handlers"
import { createProductHandlers } from "../create-product-handlers"
import { createSettingsHandlers } from "../create-settings-handlers"

export function createMockHandlers(store: MockStore) {
  function api(path: string) {
    return new URL(`/api${path}`, store.origin).href
  }

  function identifier(value: unknown): number {
    const parsed = routeIdentifierSchema.safeParse(value)
    if (!parsed.success) throw new MockStoreError(400, "Invalid record identifier.")
    return parsed.data
  }

  function query(request: Request) {
    const parsed = routeQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) throw new MockStoreError(400, "Invalid request filters.")
    return parsed.data
  }

  async function respond(operation: () => Response | Promise<Response>): Promise<Response> {
    try {
      const response = await operation()
      response.headers.set("Cache-Control", "no-store")
      return response
    } catch (error) {
      if (error instanceof MockStoreError) {
        return HttpResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }
  }

  function withScenario(
    request: Request,
    operation: Parameters<typeof respondMock>[1],
  ): Promise<Response> {
    return respondMock(request, operation, store.session)
  }

  return [
    ...createReviewHandlers(store.review, store.origin, store.session),
    ...createProductHandlers(store.product, store.origin, store.session),
    ...createSettingsHandlers(store.settings, store.origin, store.session),
    http.get(api("/session"), () =>
      respond(() => HttpResponse.json(sessionResponseSchema.parse(store.session.read()))),
    ),
    http.post(api("/session"), () =>
      respond(() => HttpResponse.json(sessionResponseSchema.parse(store.session.select("owner")))),
    ),
    http.delete(api("/session"), () =>
      respond(() =>
        HttpResponse.json(sessionResponseSchema.parse(store.session.select("signed-out"))),
      ),
    ),
    http.get(api("/workspace"), () => respond(() => HttpResponse.json(store.getWorkspace()))),

    http.get(api("/repositories/:repositoryId"), ({ request, params }) =>
      withScenario(request, (scenario) => {
        const filters = query(request)
        const response = store.getRepository(identifier(params.repositoryId), filters)
        if (scenario === "empty") {
          if (filters.page !== 1) throw new MockStoreError(404, "Page not found.")
          response.prototypes = []
          response.pagination = {
            page: 1,
            pageSize: response.pagination.pageSize,
            totalCount: 0,
            pageCount: 1,
          }
        }
        return HttpResponse.json(response)
      }),
    ),

    http.get(api("/repositories/:repositoryId/authors"), ({ request, params }) =>
      respond(() => {
        const url = new URL(request.url)
        return HttpResponse.json(
          store.getAuthors(
            identifier(params.repositoryId),
            query(request).q,
            url.searchParams.get("cursor"),
          ),
        )
      }),
    ),

    http.get(api("/repositories/:repositoryId/prototypes/:prototypeId"), ({ request, params }) =>
      withScenario(request, (scenario) => {
        const parsed = prototypeQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        if (!parsed.success) throw new MockStoreError(400, "Invalid request filters.")
        const response = store.getPrototype(
          identifier(params.repositoryId),
          identifier(params.prototypeId),
          parsed.data.build,
          parsed.data.view === "minimized",
        )
        if (scenario === "empty") {
          response.prototype.builds = []
          response.selectedBuild = null
        }
        return HttpResponse.json(response)
      }),
    ),

    http.get(
      api("/repositories/:repositoryId/prototypes/:prototypeId/builds"),
      ({ request, params }) =>
        withScenario(request, (scenario) => {
          const filters = query(request)
          const response = store.getBuildHistory(
            identifier(params.repositoryId),
            identifier(params.prototypeId),
            filters.page,
          )
          if (scenario === "empty") {
            if (filters.page !== 1) throw new MockStoreError(404, "Page not found.")
            response.builds = []
            response.pagination = {
              page: 1,
              pageSize: response.pagination.pageSize,
              totalCount: 0,
              pageCount: 1,
            }
          }
          return HttpResponse.json(response)
        }),
    ),

    http.get(
      api("/repositories/:repositoryId/prototypes/:prototypeId/builds/:buildNumber"),
      ({ request, params }) =>
        withScenario(request, () =>
          HttpResponse.json(
            store.getBuild(
              identifier(params.repositoryId),
              identifier(params.prototypeId),
              identifier(params.buildNumber),
            ),
          ),
        ),
    ),

    http.patch(api("/repositories/:repositoryId/prototypes/:prototypeId"), ({ request, params }) =>
      withScenario(request, async (_scenario, assertCurrentSession) => {
        let body: unknown
        try {
          body = await request.json()
        } catch (error) {
          if (error instanceof SyntaxError) {
            assertCurrentSession()
            return HttpResponse.json(
              { error: "The request body is not valid JSON." },
              { status: 400 },
            )
          }
          throw error
        }
        const parsed = prototypeDetailsSchema.safeParse(body)
        if (!parsed.success) {
          return HttpResponse.json(
            { error: parsed.error.issues.map(({ message }) => message).join(" ") },
            { status: 422 },
          )
        }
        return HttpResponse.json(
          store.updatePrototype(
            identifier(params.repositoryId),
            identifier(params.prototypeId),
            parsed.data,
          ),
        )
      }),
    ),
  ]
}
