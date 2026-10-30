import type { ReviewCommentsTransport } from "@hooks/use-review-comments/use-review-comments-client/types"
import {
  REVIEW_COMMENTS_SCHEMA,
  REVIEW_COMMENT_MUTATION_SCHEMA,
} from "@utils/review-comment/schemas"

import { ApiRequestError } from "../requests/api-request-error"
import { mockScenarioHeaders } from "../requests/mock-scenario-headers"
import { requestJson } from "../requests/request-json"
import { readRouteQuery } from "../read-route-query"

export function createReviewTransport(
  routeUrl: string,
  currentUrl: () => string = () => routeUrl,
): ReviewCommentsTransport {
  function headers() {
    return mockScenarioHeaders(readRouteQuery(new Request(currentUrl())).mockScenario)
  }
  return {
    async load(path, signal) {
      try {
        const response = await requestJson(new URL(path, routeUrl), REVIEW_COMMENTS_SCHEMA, {
          headers: headers(),
          signal,
        })
        return { kind: "success", comments: response.comments }
      } catch (error) {
        if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
          return { kind: "access-lost" }
        }
        throw error
      }
    },
    async change(path, method, body, signal) {
      const response = await requestJson(new URL(path, routeUrl), REVIEW_COMMENT_MUTATION_SCHEMA, {
        method,
        headers: headers(),
        signal,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      return response.comments
    },
  }
}
