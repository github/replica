import { http, HttpResponse } from "msw"

import { learningDecisionInputSchema } from "@application/hub/learnings-contracts"

import type { createLearningsStore } from "../create-learnings-store"
import type { MockSession } from "../create-mock-session/types"
import { parseMockRecordIdentifier as recordIdentifier } from "../parse-mock-record-identifier"
import { readMockJson } from "../read-mock-json"
import { respondMock } from "../respond-mock"
import { MockStoreError } from "../store-error"

export function createLearningsHandlers(
  store: ReturnType<typeof createLearningsStore>,
  origin: string,
  session?: MockSession,
) {
  function api(path: string) {
    return new URL(`/api${path}`, origin).href
  }

  return [
    http.get(api("/repositories/:repositoryId/learnings"), ({ request, params }) =>
      respondMock(
        request,
        (scenario) => {
          const response = store.get(recordIdentifier(params.repositoryId))
          if (!response.accessDenied && scenario === "empty") {
            response.suggestions = []
            response.learnings = []
            response.recall = { text: "", count: 0 }
            response.runs = []
            response.usageCredits = "0"
          }
          return HttpResponse.json(response)
        },
        session,
      ),
    ),
    http.post(api("/repositories/:repositoryId/learnings/runs"), ({ request, params }) =>
      respondMock(
        request,
        (_scenario, assertCurrentSession) => {
          assertCurrentSession()
          return HttpResponse.json(store.run(recordIdentifier(params.repositoryId)))
        },
        session,
      ),
    ),
    http.post(
      api("/repositories/:repositoryId/learnings/:learningId/decision"),
      ({ request, params }) =>
        respondMock(
          request,
          async (_scenario, assertCurrentSession) => {
            if (typeof params.learningId !== "string" || !params.learningId) {
              throw new MockStoreError(400, "Invalid learning identifier.")
            }
            const input = await readMockJson(request, learningDecisionInputSchema)
            assertCurrentSession()
            return HttpResponse.json(
              store.decide(
                recordIdentifier(params.repositoryId),
                decodeURIComponent(params.learningId),
                input,
              ),
            )
          },
          session,
        ),
    ),
  ]
}
