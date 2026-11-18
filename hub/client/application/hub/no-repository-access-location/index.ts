import { z } from "zod"

import { ApiRequestError } from "@application/hub/requests/api-request-error"

const denialSchema = z.object({
  login: z.string().max(200).nullable(),
  reason: z.literal("no_repository_access"),
})

export function noRepositoryAccessLocation(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.status !== 401) return null
  const denial = denialSchema.safeParse(error.body)
  if (!denial.success) return null
  return "/signed-in/no-access"
}
