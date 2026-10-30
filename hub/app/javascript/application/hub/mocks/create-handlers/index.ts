import { delay, http, HttpResponse } from "msw"

import {
  mockScenarioSchema,
  prototypeDetailsSchema,
  routeIdentifierSchema,
  routeQuerySchema,
} from "../../contracts"
import type { MockScenario } from "../../contracts"
import type { MockStore } from "../create-store"
import { MockStoreError } from "../store-error"

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

  async function withScenario(
    request: Request,
    operation: (scenario: MockScenario) => Response | Promise<Response>,
  ): Promise<Response> {
    const parsed = mockScenarioSchema.safeParse(
      request.headers.get("X-Replica-Mock-Scenario") ?? "normal",
    )
    if (!parsed.success) {
      return HttpResponse.json({ error: "Unknown mock scenario." }, { status: 400 })
    }
    const scenario = parsed.data
    if (scenario === "loading") await delay(1500)
    if (scenario === "forbidden") {
      return HttpResponse.json({ error: "You cannot access this mock resource." }, { status: 403 })
    }
    if (scenario === "server-error" || (scenario === "save-error" && request.method === "PATCH")) {
      return HttpResponse.json(
        { error: "The mock API could not complete the request." },
        { status: 500 },
      )
    }
    if (scenario === "invalid-response") {
      return HttpResponse.json({ unexpected: "This intentionally fails the API schema." })
    }
    return respond(() => operation(scenario))
  }

  return [
    http.get(api("/workspace"), () => respond(() => HttpResponse.json(store.getWorkspace()))),

    http.get(api("/repositories/:repositoryId"), ({ request, params }) =>
      withScenario(request, (scenario) => {
        const filters = query(request)
        const response = store.getRepository(identifier(params.repositoryId), filters)
        if (scenario === "empty") {
          if (filters.page !== 1) throw new MockStoreError(404, "Page not found.")
          response.prototypes = []
          response.pagination = { page: 1, pageSize: 2, totalCount: 0, pageCount: 1 }
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
        const response = store.getPrototype(
          identifier(params.repositoryId),
          identifier(params.prototypeId),
          query(request).build,
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
            response.pagination = { page: 1, pageSize: 2, totalCount: 0, pageCount: 1 }
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
      withScenario(request, async () => {
        let body: unknown
        try {
          body = await request.json()
        } catch (error) {
          if (error instanceof SyntaxError) {
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
