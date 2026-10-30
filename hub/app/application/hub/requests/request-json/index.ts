import type { z } from "zod"

import { bootstrapHubApi } from "../../bootstrap"
import { apiErrorSchema } from "../../contracts"
import { ApiContractError } from "../api-contract-error"
import { ApiRequestError } from "../api-request-error"
import { mockSessionContext } from "../mock-session-context"

interface JsonRequestInit extends Omit<RequestInit, "body"> {
  body?: string
}

export async function requestJson<T>(
  url: URL,
  schema: z.ZodType<T>,
  init: JsonRequestInit = {},
): Promise<T> {
  init.signal?.throwIfAborted()
  await bootstrapHubApi()
  init.signal?.throwIfAborted()

  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (init.body !== undefined) headers.set("Content-Type", "application/json")
  if (
    import.meta.env.DEV &&
    import.meta.env.MODE === "mock" &&
    !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) &&
    mockSessionContext.revision !== undefined
  ) {
    headers.set("X-Replica-Mock-Session-Revision", String(mockSessionContext.revision))
  }

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    })
  } catch (error) {
    init.signal?.throwIfAborted()
    if (error instanceof TypeError) {
      throw new ApiRequestError(0, "Unable to reach the Hub API.")
    }
    throw error
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiContractError("The API returned invalid JSON.", response.status)
    }
    throw error
  }

  if (!response.ok) {
    const result = apiErrorSchema.safeParse(payload)
    if (!result.success) {
      throw new ApiContractError("The API returned an invalid error response.", response.status)
    }
    throw new ApiRequestError(response.status, result.data.error)
  }

  const result = schema.safeParse(payload)
  if (!result.success) {
    throw new ApiContractError("The API returned data in an unexpected shape.", response.status)
  }
  return result.data
}
