import { z } from "zod"

import { requestJson } from "../request-json"

export async function authorizeCopilotHandoff(repositoryId: string) {
  const permission = await requestJson(
    new URL(`/api/repositories/${repositoryId}/create/permission`, window.location.origin),
    z.object({ canCreate: z.boolean() }),
  )
  return permission.canCreate
}
