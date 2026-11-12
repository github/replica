import { z } from "zod"

export const sessionRevocationStatusResponseSchema = z
  .object({
    status: z
      .object({
        activeSessionCount: z.number().int().nonnegative(),
        pendingAuthenticationCount: z.number().int().nonnegative(),
        pendingSensitiveAuthorizationCount: z.number().int().nonnegative(),
        revision: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()

export const sessionRevocationAuthorizationStartResponseSchema = z
  .object({
    authorizationId: z.uuid(),
    authorizationUrl: z.url({ protocol: /^https?$/ }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export const sessionRevocationAuthorizationResponseSchema = z
  .object({
    authorization: z
      .object({
        expiresAt: z.iso.datetime({ offset: true }),
        operation: z.literal("END_ALL_HUB_SESSIONS"),
        verifiedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict()

export const sessionRevocationContinuationResponseSchema = z
  .object({
    result: z
      .object({
        cancelledAuthorizationCount: z.number().int().nonnegative(),
        endedSessionCount: z.number().int().nonnegative(),
        revision: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
