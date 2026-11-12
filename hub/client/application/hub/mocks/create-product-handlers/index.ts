import { http, HttpResponse } from "msw"

import { routeQuerySchema } from "@application/hub/contracts"
import {
  productMetadataInputSchema,
  productShareIdSchema,
  productShareInputSchema,
  productSharingSettingsInputSchema,
  productTemplateIdSchema,
} from "@application/hub/product-contracts"

import type { createProductStore } from "../create-product-store"
import type { MockSession } from "../create-mock-session/types"
import { parseMockIdentifier as identifier } from "../parse-mock-identifier"
import { parseMockRecordIdentifier as recordIdentifier } from "../parse-mock-record-identifier"
import { parseMockQuery } from "../parse-mock-query"
import { readMockJson } from "../read-mock-json"
import { respondMock } from "../respond-mock"
import { MockStoreError } from "../store-error"

export function createProductHandlers(
  store: ReturnType<typeof createProductStore>,
  origin: string,
  session?: MockSession,
) {
  function api(path: string) {
    return new URL(`/api${path}`, origin).href
  }

  function shareId(value: unknown) {
    const parsed = productShareIdSchema.safeParse(value)
    if (!parsed.success) throw new MockStoreError(400, "Invalid share identifier.")
    return parsed.data
  }

  return [
    http.get(api("/repositories/:repositoryId/templates"), ({ request, params }) =>
      respondMock(
        request,
        (scenario) => {
          const response = store.getCatalog(recordIdentifier(params.repositoryId))
          if (scenario === "empty") response.templates = []
          return HttpResponse.json(response)
        },
        session,
      ),
    ),
    http.get(api("/repositories/:repositoryId/templates/:templateId"), ({ request, params }) =>
      respondMock(
        request,
        () => {
          const parsed = productTemplateIdSchema.safeParse(params.templateId)
          if (!parsed.success) throw new MockStoreError(400, "Invalid template identifier.")
          return HttpResponse.json(
            store.getTemplate(recordIdentifier(params.repositoryId), parsed.data),
          )
        },
        session,
      ),
    ),
    http.get(api("/repositories/:repositoryId/prototype-management"), ({ request, params }) =>
      respondMock(
        request,
        (scenario) => {
          const response = store.getManagement(recordIdentifier(params.repositoryId))
          if (scenario === "empty") {
            response.registered = []
            response.candidates = []
          }
          return HttpResponse.json(response)
        },
        session,
      ),
    ),
    http.patch(
      api("/repositories/:repositoryId/prototype-management/:prototypeId"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            const input = await readMockJson(request, productMetadataInputSchema)
            const repositoryId = recordIdentifier(params.repositoryId)
            const prototypeId = recordIdentifier(params.prototypeId)
            assertCurrentSession()
            return HttpResponse.json(store.updateMetadata(repositoryId, prototypeId, input))
          },
          session,
        ),
    ),
    http.post(
      api("/repositories/:repositoryId/prototype-candidates/:candidateId"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            const input = await readMockJson(request, productMetadataInputSchema)
            const repositoryId = recordIdentifier(params.repositoryId)
            const candidateId = identifier(params.candidateId)
            assertCurrentSession()
            return HttpResponse.json(store.registerCandidate(repositoryId, candidateId, input))
          },
          session,
        ),
    ),
    http.get(
      api("/repositories/:repositoryId/prototypes/:prototypeId/share-links"),
      ({ request, params }) =>
        respondMock(
          request,
          (scenario) => {
            const query = parseMockQuery(request.url, routeQuerySchema, "Invalid Build selection.")
            const response = store.getShareLinks(
              recordIdentifier(params.repositoryId),
              recordIdentifier(params.prototypeId),
              query.build,
            )
            if (scenario === "empty") response.links = []
            return HttpResponse.json(response)
          },
          session,
        ),
    ),
    http.post(
      api("/repositories/:repositoryId/prototypes/:prototypeId/share-links"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            const input = await readMockJson(request, productShareInputSchema)
            const repositoryId = recordIdentifier(params.repositoryId)
            const prototypeId = recordIdentifier(params.prototypeId)
            assertCurrentSession()
            return HttpResponse.json(store.createShareLink(repositoryId, prototypeId, input))
          },
          session,
        ),
    ),
    http.delete(
      api("/repositories/:repositoryId/prototypes/:prototypeId/share-links/:shareId"),
      ({ request, params }) =>
        respondMock(
          request,
          (_scenario, assertCurrentSession) => {
            const repositoryId = recordIdentifier(params.repositoryId)
            const prototypeId = recordIdentifier(params.prototypeId)
            const id = shareId(params.shareId)
            assertCurrentSession()
            return HttpResponse.json(store.revokeShareLink(repositoryId, prototypeId, id))
          },
          session,
        ),
    ),
    http.get(api("/product/sharing-settings"), ({ request }) =>
      respondMock(request, () => HttpResponse.json(store.getSharingSettings()), session),
    ),
    http.patch(api("/product/sharing-settings"), ({ request }) =>
      respondMock(
        request,
        async (_scenario, assertCurrentSession) => {
          const input = await readMockJson(request, productSharingSettingsInputSchema)
          assertCurrentSession()
          return HttpResponse.json(store.updateSharingSettings(input))
        },
        session,
      ),
    ),
    http.get(api("/shared/:shareId"), ({ request, params }) =>
      respondMock(
        request,
        () => HttpResponse.json(store.getPublicShare(shareId(params.shareId))),
        session,
      ),
    ),
  ]
}
