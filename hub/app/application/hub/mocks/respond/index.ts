import { delay, HttpResponse } from "msw"

import { mockScenarioSchema } from "../../contracts"
import type { MockScenario } from "../../contracts"
import { MockStoreError } from "../store-error"
import type { MockSession } from "../create-session"

export async function respondMock(
  request: Request,
  operation: (
    scenario: MockScenario,
    assertCurrentSession: () => void,
  ) => Response | Promise<Response>,
  session?: MockSession,
): Promise<Response> {
  try {
    const header = request.headers.get("X-Replica-Mock-Session-Revision")
    if (header !== null && !/^\d+$/.test(header)) {
      throw new MockStoreError(400, "Invalid mock session revision.")
    }
    const revision = header === null ? session?.read().revision : Number(header)
    function assertCurrentSession() {
      request.signal.throwIfAborted()
      if (
        session &&
        !["GET", "HEAD"].includes(request.method) &&
        revision !== session.read().revision
      ) {
        throw new MockStoreError(409, "The mock user changed. This action was canceled.")
      }
    }
    const parsed = mockScenarioSchema.safeParse(
      request.headers.get("X-Replica-Mock-Scenario") ?? "normal",
    )
    if (!parsed.success) throw new MockStoreError(400, "Unknown mock scenario.")
    const scenario = parsed.data
    if (scenario === "loading") await delay(1500)
    assertCurrentSession()
    if (scenario === "forbidden") {
      throw new MockStoreError(403, "You cannot access this mock resource.")
    }
    if (
      scenario === "server-error" ||
      (scenario === "save-error" && !["GET", "HEAD"].includes(request.method))
    ) {
      throw new MockStoreError(500, "The mock API could not complete the request.")
    }
    const response =
      scenario === "invalid-response"
        ? HttpResponse.json({ unexpected: "This intentionally fails the API schema." })
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
