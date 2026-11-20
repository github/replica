import { z } from "zod"

import { ApiRequestError } from "../api-request-error"
import { requestJson } from "../request-json"

export async function authorizeCopilotHandoff(repositoryId: string) {
  try {
    const permission = await requestJson(
      new URL(`/api/repositories/${repositoryId}/create/permission`, window.location.origin),
      z.object({ canCreate: z.boolean() }),
    )
    return permission.canCreate
  } catch (error) {
    // Hub hides repositories the viewer can no longer see behind a 404.
    if (error instanceof ApiRequestError && error.status === 404) return false
    throw error
  }
}
