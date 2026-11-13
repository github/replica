import { z } from "zod"

export const copilotConnectionStatusSchema = z
  .object({
    configured: z.boolean(),
    connected: z.boolean(),
    savedConnection: z.boolean(),
    connectedBy: z
      .object({
        login: z.string().nullable(),
        membershipId: z.uuid(),
        name: z.string().nullable(),
      })
      .strict()
      .nullable(),
    refusedAt: z.iso.datetime({ offset: true }).nullable(),
    verifiedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()

export const copilotAuthorizationStartResponseSchema = z
  .object({
    authorizationId: z.uuid(),
    authorizationUrl: z.url({ protocol: /^https?$/ }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export const copilotAuthorizationResponseSchema = z
  .object({
    authorization: z
      .object({
        expiresAt: z.iso.datetime({ offset: true }),
        operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
        verifiedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict()

export const copilotContinuationResponseSchema = z.union([
  z.object({ connectionId: z.uuid() }).strict(),
  z.object({ disconnected: z.literal(true) }).strict(),
])
