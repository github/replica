import { currentHubSessionSchema } from "@application/hub/administrator-contracts"

import { ApiContractError } from "../api-contract-error"
import { ApiRequestError } from "../api-request-error"
import { requestJson } from "../request-json"

export async function getCurrentHubSession(request: Request) {
  try {
    return await requestJson(new URL("/api/auth/session", request.url), currentHubSessionSchema, {
      signal: request.signal,
    })
  } catch (error) {
    if (error instanceof ApiContractError && error.status === 401) {
      throw new ApiRequestError(401, "Sign in to continue.")
    }
    throw error
  }
}
