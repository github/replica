import { z } from "zod"

export const copilotConnectionStatusSchema = z
  .object({
    configured: z.boolean(),
    connected: z.boolean(),
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
