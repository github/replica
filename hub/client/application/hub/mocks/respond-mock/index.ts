import { delay, HttpResponse } from "msw"

import { mockScenarioSchema } from "../contracts"
import type { MockScenario } from "../contracts/types"
import { mockDiagnostics } from "../diagnostics"
import { MockStoreError } from "../store-error"
import type { MockSession } from "../create-mock-session/types"

const loadingDelayMs = 1500

export async function respondMock(
  request: Request,
  operation: (
    scenario: MockScenario,
    assertCurrentSession: () => void,
  ) => Response | Promise<Response>,
  session?: MockSession,
): Promise<Response> {
  try {
    const revision = session?.read().revision
    function assertCurrentSession() {
      request.signal.throwIfAborted()
      if (
        session &&
        !["GET", "HEAD"].includes(request.method) &&
        revision !== session.read().revision
      ) {
        throw new MockStoreError(409, "Your session changed. Try the action again.")
      }
    }
    const parsed = mockScenarioSchema.safeParse(
      request.headers.get("X-Replica-Mock-Scenario") ?? mockDiagnostics.getSnapshot().scenario,
    )
    if (!parsed.success) throw new MockStoreError(400, "Unknown mock scenario.")
    const scenario = parsed.data
    if (scenario !== "normal") {
      mockDiagnostics.report(
        `${request.method} ${new URL(request.url).pathname}: ${scenario} response selected.`,
      )
    }
    if (scenario === "loading") await delay(loadingDelayMs)
    assertCurrentSession()
    if (scenario === "forbidden") {
      throw new MockStoreError(403, "You do not have access to this resource.")
    }
    if (
      scenario === "server-error" ||
      (scenario === "save-error" && !["GET", "HEAD"].includes(request.method))
    ) {
      throw new MockStoreError(500, "The request could not be completed. Try again.")
    }
    const response =
      scenario === "invalid-response"
        ? HttpResponse.json({ unexpected: true })
        : await operation(scenario, assertCurrentSession)
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch (error) {
    if (error instanceof MockStoreError) {
      return HttpResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      )
    }
    throw error
  }
}
