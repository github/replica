import { currentHubSessionSchema } from "@application/hub/administrator-contracts"

import { requestJson } from "../request-json"

export function getCurrentHubSession(request: Request) {
  return requestJson(new URL("/api/auth/session", request.url), currentHubSessionSchema, {
    signal: request.signal,
  })
}
