import type { ReviewCommentsTransport } from "@hooks/use-review-comments/use-review-comments-client/types"
import {
  REVIEW_COMMENTS_SCHEMA,
  REVIEW_COMMENT_MUTATION_SCHEMA,
} from "@utils/review-comment/schemas"

import { ApiContractError } from "../requests/api-contract-error"
import { ApiRequestError } from "../requests/api-request-error"
import { requestJson } from "../requests/request-json"

function reviewAccessWasLost(error: unknown) {
  return (
    (error instanceof ApiRequestError || error instanceof ApiContractError) &&
    [401, 403, 404, 503].includes(error.status)
  )
}

export function createReviewTransport(routeUrl: string): ReviewCommentsTransport {
  return {
    async load(path, signal) {
      try {
        const response = await requestJson(new URL(path, routeUrl), REVIEW_COMMENTS_SCHEMA, {
          signal,
        })
        return { kind: "success", comments: response.comments }
      } catch (error) {
        if (reviewAccessWasLost(error)) {
          return { kind: "access-lost" }
        }
        throw error
      }
    },
    async change(path, method, body, signal) {
      try {
        const response = await requestJson(
          new URL(path, routeUrl),
          REVIEW_COMMENT_MUTATION_SCHEMA,
          {
            method,
            signal,
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        )
        return { kind: "success", comments: response.comments }
      } catch (error) {
        if (reviewAccessWasLost(error)) {
          return { kind: "access-lost" }
        }
        throw error
      }
    },
  }
}
