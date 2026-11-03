import { http, HttpResponse } from "msw"

import { routeIdentifierSchema, routeQuerySchema } from "../../contracts"
import {
  productCreateInputSchema,
  productMetadataInputSchema,
  productShareIdSchema,
  productShareInputSchema,
  productSharingSettingsInputSchema,
  productTemplateIdSchema,
} from "../../product-contracts"
import type { createProductStore } from "../create-product-store"
import type { MockSession } from "../create-session"
import { readMockJson } from "../read-json"
import { respondMock } from "../respond"
import { MockStoreError } from "../store-error"

export function createProductHandlers(
  store: ReturnType<typeof createProductStore>,
  origin: string,
  session?: MockSession,
) {
  function api(path: string) {
    return new URL(`/api${path}`, origin).href
  }

  function identifier(value: unknown): number {
    const parsed = routeIdentifierSchema.safeParse(value)
    if (!parsed.success) throw new MockStoreError(400, "Invalid record identifier.")
    return parsed.data
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
          const response = store.getCatalog(identifier(params.repositoryId))
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
          return HttpResponse.json(store.getTemplate(identifier(params.repositoryId), parsed.data))
        },
        session,
      ),
    ),
    http.post(api("/repositories/:repositoryId/prototypes"), ({ request, params }) =>
      respondMock(
        request,
        async (_scenario, assertCurrentSession) => {
          const input = await readMockJson(request, productCreateInputSchema)
          const repositoryId = identifier(params.repositoryId)
          assertCurrentSession()
          return HttpResponse.json(store.createPrototype(repositoryId, input))
        },
        session,
      ),
    ),
    http.get(api("/repositories/:repositoryId/prototype-management"), ({ request, params }) =>
      respondMock(
        request,
        (scenario) => {
          const response = store.getManagement(identifier(params.repositoryId))
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
            const repositoryId = identifier(params.repositoryId)
            const prototypeId = identifier(params.prototypeId)
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
            const repositoryId = identifier(params.repositoryId)
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
            const query = routeQuerySchema.safeParse(
              Object.fromEntries(new URL(request.url).searchParams),
            )
            if (!query.success) throw new MockStoreError(400, "Invalid Build selection.")
            const response = store.getShareLinks(
              identifier(params.repositoryId),
              identifier(params.prototypeId),
              query.data.build,
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
            const repositoryId = identifier(params.repositoryId)
            const prototypeId = identifier(params.prototypeId)
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
            const repositoryId = identifier(params.repositoryId)
            const prototypeId = identifier(params.prototypeId)
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
