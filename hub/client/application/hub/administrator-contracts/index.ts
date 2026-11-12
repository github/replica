import { z } from "zod"

const administratorOperationSchema = z.enum(["DESIGNATE_ADMINISTRATORS", "REVOKE_ADMINISTRATOR"])
const administratorIdentitySchema = z.object({
  membershipId: z.uuid(),
  provider: z.string().min(1).nullable(),
  login: z.string().min(1).nullable(),
  name: z.string().nullable(),
})

export const currentHubSessionSchema = z
  .object({
    authenticated: z.literal(true),
    membershipId: z.uuid(),
    userId: z.uuid(),
    provider: z.string().min(1),
    login: z.string().min(1),
    name: z.string().nullable(),
    role: z.enum(["MEMBER", "ADMINISTRATOR"]),
  })
  .strict()

export const administratorsResponseSchema = z
  .object({
    administrators: z.array(
      administratorIdentitySchema.extend({
        userId: z.uuid(),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict()

export const administratorCandidatesResponseSchema = z
  .object({ candidates: z.array(administratorIdentitySchema) })
  .strict()

export const administratorAuthorizationResponseSchema = z
  .object({
    authorization: z
      .object({
        operation: administratorOperationSchema,
        targets: z.array(administratorIdentitySchema).min(1).max(50),
        verifiedAt: z.iso.datetime({ offset: true }),
        expiresAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict()

export const administratorAuthorizationStartInputSchema = z
  .object({
    operation: administratorOperationSchema,
    targetMembershipIds: z.array(z.uuid()).min(1).max(50),
  })
  .strict()

export const administratorAuthorizationStartResponseSchema = z
  .object({
    authorizationId: z.uuid(),
    authorizationUrl: z.url({ protocol: /^https?$/ }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict()

export const administratorContinuationResponseSchema = z
  .object({
    result: z.union([
      z
        .object({
          assignmentId: z.uuid(),
          membershipId: z.uuid(),
        })
        .strict(),
      z
        .array(
          z
            .object({
              assignmentId: z.uuid(),
              membershipId: z.uuid(),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    ]),
  })
  .strict()

export { administratorOperationSchema }
