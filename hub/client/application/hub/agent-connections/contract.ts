import { z } from "zod"

export const agentAuthorizationSchema = z
  .object({
    agent: z.string().min(1),
    redirectUri: z.url(),
    session: z.string().min(1).max(255),
    signedInAs: z.string().min(1),
    expiresAt: z.iso.datetime(),
  })
  .strict()

export const agentDecisionSchema = z.object({ redirectUrl: z.url() }).strict()

export const agentConnectionsSchema = z
  .object({
    connections: z.array(
      z
        .object({
          id: z.uuid(),
          agent: z.string().min(1),
          createdAt: z.iso.datetime(),
          lastUsedAt: z.iso.datetime().nullable(),
          inactiveAt: z.iso.datetime(),
        })
        .strict(),
    ),
  })
  .strict()
