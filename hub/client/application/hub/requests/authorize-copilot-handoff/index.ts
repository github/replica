import { z } from "zod"

import { ApiRequestError } from "../api-request-error"
import { requestJson } from "../request-json"

const copyFallback = z.object({ canCopy: z.literal(true) })

export async function authorizeCopilotHandoff(
  repositoryId: string,
  { allowCopyFallback = false } = {},
): Promise<boolean | "copy"> {
  try {
    const permission = await requestJson(
      new URL(`/api/repositories/${repositoryId}/create/permission`, window.location.origin),
      z.object({ canCreate: z.boolean() }),
    )
    return permission.canCreate
  } catch (error) {
    // Hub hides repositories the viewer can no longer see behind a 404.
    if (error instanceof ApiRequestError && error.status === 404) return false
    if (
      allowCopyFallback &&
      error instanceof ApiRequestError &&
      error.status === 503 &&
      copyFallback.safeParse(error.body).success
    ) {
      return "copy"
    }
    throw error
  }
}
