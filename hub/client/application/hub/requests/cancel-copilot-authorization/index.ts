import { requestJson } from "../request-json"
import { z } from "zod"

export function cancelCopilotAuthorization(request: Request, authorizationId: string) {
  return requestJson(
    new URL("/api/copilot-connection/authorizations/cancel", request.url),
    z.undefined(),
    {
      body: JSON.stringify({ authorizationId }),
      method: "POST",
      signal: request.signal,
    },
  )
}
