import type { z } from "zod"

import type {
  sessionRevocationAuthorizationResponseSchema,
  sessionRevocationStatusResponseSchema,
} from "."

export type SessionRevocationStatus = z.infer<
  typeof sessionRevocationStatusResponseSchema
>["status"]
export type SessionRevocationAuthorization = z.infer<
  typeof sessionRevocationAuthorizationResponseSchema
>["authorization"]
