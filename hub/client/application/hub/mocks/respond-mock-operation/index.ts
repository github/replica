import { HttpResponse } from "msw"

import { MockStoreError } from "../store-error"

export async function respondMockOperation(
  operation: () => Response | Promise<Response>,
): Promise<Response> {
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
