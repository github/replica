import { z } from "zod"

import { requestJson } from "../request-json"

export async function cancelSessionRevocationAuthorization(
  request: Request,
  authorizationId: string,
) {
  await requestJson(
    new URL("/api/session-revocation/authorizations/cancel", request.url),
    z.undefined(),
    {
      method: "POST",
      body: JSON.stringify({ authorizationId }),
      signal: request.signal,
    },
  )
}
