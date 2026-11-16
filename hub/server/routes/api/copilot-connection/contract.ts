import { z } from "zod"

export const copilotConnectionStatusSchema = z
  .object({
    configured: z.boolean(),
    connected: z.boolean(),
    savedConnection: z.boolean(),
    credentialIdentity: z
      .object({
        appId: z.string().regex(/^[1-9]\d*$/),
        installationId: z.string().regex(/^[1-9]\d*$/),
        organization: z.string().min(1).max(39),
      })
      .strict()
      .nullable()
      .default(null),
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
