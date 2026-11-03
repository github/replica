import { http, HttpResponse } from "msw"
import { z } from "zod"

import { createByteLimitedStringSchema } from "@utils/create-byte-limited-string-schema"
import { REVIEW_ANCHOR_SCHEMA } from "@utils/review-anchor/schemas"
import { REACTION_CONTENT_SCHEMA } from "@utils/review-comment/schemas"

import { routeIdentifierSchema } from "../../contracts"
import type { ReviewMockStore } from "../create-review-store"
import { readMockJson } from "../read-json"
import { respondMock as respondWithSession } from "../respond"
import { MockStoreError } from "../store-error"
import type { MockSession } from "../create-session"

const bodySchema = createByteLimitedStringSchema(10_000, { required: true })
const commentBody = z.object({ review_comment: z.object({ body: bodySchema }) })
const version = z.number().int().positive()

export function createReviewHandlers(
  store: ReviewMockStore,
  origin: string,
  session?: MockSession,
) {
  const base = new URL(
    "/api/repositories/:repositoryId/prototypes/:prototypeId/review-comments",
    origin,
  ).href
  function respondMock(request: Request, operation: Parameters<typeof respondWithSession>[1]) {
    return respondWithSession(request, operation, session)
  }
  function id(value: unknown) {
    const parsed = routeIdentifierSchema.safeParse(value)
    if (!parsed.success) throw new MockStoreError(400, "Invalid review identifier.")
    return parsed.data
  }
  return [
    http.get(base, ({ request, params }) =>
      respondMock(request, (scenario) => {
        const response = store.list(id(params.repositoryId), id(params.prototypeId))
        return HttpResponse.json(scenario === "empty" ? { ...response, comments: [] } : response)
      }),
    ),
    http.post(base, ({ request, params }) =>
      respondMock(request, async (_scenario, assertCurrentSession) => {
        const input = await readMockJson(
          request,
          z.object({
            review_comment: z.object({
              body: bodySchema,
              build_number: version,
              anchor: REVIEW_ANCHOR_SCHEMA,
            }),
          }),
        )
        assertCurrentSession()
        return HttpResponse.json(
          store.create(
            id(params.repositoryId),
            id(params.prototypeId),
            input.review_comment.build_number,
            input.review_comment.body,
            input.review_comment.anchor,
          ),
        )
      }),
    ),
    http.post(`${base}/:commentId/replies`, ({ request, params }) =>
      respondMock(request, async (_scenario, assertCurrentSession) => {
        const input = await readMockJson(request, commentBody)
        assertCurrentSession()
        return HttpResponse.json(
          store.reply(
            id(params.repositoryId),
            id(params.prototypeId),
            id(params.commentId),
            input.review_comment.body,
          ),
        )
      }),
    ),
    http.patch(`${base}/:commentId`, ({ request, params }) =>
      respondMock(request, async (_scenario, assertCurrentSession) => {
        const input = await readMockJson(request, commentBody)
        assertCurrentSession()
        return HttpResponse.json(
          store.edit(
            id(params.repositoryId),
            id(params.prototypeId),
            id(params.commentId),
            input.review_comment.body,
          ),
        )
      }),
    ),
    http.delete(`${base}/:commentId`, ({ request, params }) =>
      respondMock(request, () =>
        HttpResponse.json(
          store.edit(id(params.repositoryId), id(params.prototypeId), id(params.commentId), null),
        ),
      ),
    ),
    ...(["post", "delete"] as const).map((method) =>
      http[method](`${base}/:commentId/resolution`, ({ request, params }) =>
        respondMock(request, () =>
          HttpResponse.json(
            store.resolve(
              id(params.repositoryId),
              id(params.prototypeId),
              id(params.commentId),
              method === "post",
            ),
          ),
        ),
      ),
    ),
    http.post(`${base}/:commentId/reactions`, ({ request, params }) =>
      respondMock(request, async (_scenario, assertCurrentSession) => {
        const input = await readMockJson(
          request,
          z.object({
            review_comment_reaction: z.object({
              content: REACTION_CONTENT_SCHEMA,
              activity_version: version,
            }),
          }),
        )
        assertCurrentSession()
        return HttpResponse.json(
          store.react(
            id(params.repositoryId),
            id(params.prototypeId),
            id(params.commentId),
            input.review_comment_reaction.content,
            input.review_comment_reaction.activity_version,
            true,
          ),
        )
      }),
    ),
    http.delete(`${base}/:commentId/reactions/:content`, ({ request, params }) =>
      respondMock(request, async (_scenario, assertCurrentSession) => {
        const input = await readMockJson(
          request,
          z.object({ review_comment_reaction: z.object({ activity_version: version }) }),
        )
        const content = REACTION_CONTENT_SCHEMA.safeParse(params.content)
        if (!content.success) throw new MockStoreError(400, "Unknown reaction.")
        assertCurrentSession()
        return HttpResponse.json(
          store.react(
            id(params.repositoryId),
            id(params.prototypeId),
            id(params.commentId),
            content.data,
            input.review_comment_reaction.activity_version,
            false,
          ),
        )
      }),
    ),
    http.post(`${base}/:commentId/read`, ({ request, params }) =>
      respondMock(request, async (_scenario, assertCurrentSession) => {
        const input = await readMockJson(
          request,
          z.object({ review_thread_read: z.object({ activity_version: version }) }),
        )
        assertCurrentSession()
        return HttpResponse.json(
          store.markRead(
            id(params.repositoryId),
            id(params.prototypeId),
            id(params.commentId),
            input.review_thread_read.activity_version,
          ),
        )
      }),
    ),
    http.delete(`${base}/:commentId/read`, ({ request, params }) =>
      respondMock(request, () =>
        HttpResponse.json(
          store.markRead(
            id(params.repositoryId),
            id(params.prototypeId),
            id(params.commentId),
            null,
          ),
        ),
      ),
    ),
  ]
}
