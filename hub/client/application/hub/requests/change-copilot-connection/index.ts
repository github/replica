import { z } from "zod"

import { requestJson } from "../request-json"

export function changeCopilotConnection(request: Request, operation: "connect" | "disconnect") {
  return requestJson(
    new URL(
      operation === "connect" ? "/api/copilot-connection/connect" : "/api/copilot-connection",
      request.url,
    ),
    z.undefined(),
    {
      body: JSON.stringify({ confirmed: true }),
      method: operation === "connect" ? "POST" : "DELETE",
      signal: request.signal,
    },
  )
}
