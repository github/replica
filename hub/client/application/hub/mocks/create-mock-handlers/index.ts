import { http, HttpResponse } from "msw"

import {
  prototypeDetailsSchema,
  prototypeQuerySchema,
  routeQuerySchema,
} from "@application/hub/contracts"
import { sessionResponseSchema } from "@application/hub/session-contracts"

import type { MockStore } from "../create-mock-store/types"
import { MockStoreError } from "../store-error"
import { parseMockIdentifier as identifier } from "../parse-mock-identifier"
import { parseMockRecordIdentifier as recordIdentifier } from "../parse-mock-record-identifier"
import { parseMockQuery } from "../parse-mock-query"
import { respondMock } from "../respond-mock"
import { respondMockOperation as respond } from "../respond-mock-operation"
import { createReviewHandlers } from "../create-review-handlers"
import { createProductHandlers } from "../create-product-handlers"
import { createSettingsHandlers } from "../create-settings-handlers"

export function createMockHandlers(store: MockStore) {
  function api(path: string) {
    return new URL(`/api${path}`, store.origin).href
  }

  function query(request: Request) {
    return parseMockQuery(request.url, routeQuerySchema)
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
        const response = store.getRepository(recordIdentifier(params.repositoryId), filters)
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
            recordIdentifier(params.repositoryId),
            query(request).q,
            url.searchParams.get("cursor"),
          ),
        )
      }),
    ),

    http.get(api("/repositories/:repositoryId/prototypes/:prototypeId"), ({ request, params }) =>
      withScenario(request, (scenario) => {
        const parsed = parseMockQuery(request.url, prototypeQuerySchema)
        const response = store.getPrototype(
          recordIdentifier(params.repositoryId),
          recordIdentifier(params.prototypeId),
          parsed.build,
          parsed.view === "minimized",
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
            recordIdentifier(params.repositoryId),
            recordIdentifier(params.prototypeId),
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
              recordIdentifier(params.repositoryId),
              recordIdentifier(params.prototypeId),
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
            recordIdentifier(params.repositoryId),
            recordIdentifier(params.prototypeId),
            parsed.data,
          ),
        )
      }),
    ),
  ]
}
