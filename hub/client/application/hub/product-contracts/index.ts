import { z } from "zod"

import {
  prototypeDetailsSchema,
  prototypeResponseSchema,
  prototypeSchema,
  prototypeStartPageSchema,
  recordIdentifierSchema,
  repositorySchema,
} from "../contracts"

const identifier = z.number().int().positive()
const httpUrl = z.url({ protocol: /^https?$/ })
const timestamp = z.iso.datetime({ offset: true })

const routeSegment = z
  .string()
  .regex(/^[a-z0-9._~-]+$/i)
  .refine((value) => value !== "." && value !== "..")

export const productTemplateIdSchema = routeSegment
export const productShareIdSchema = routeSegment
export const productStartPageSchema = prototypeStartPageSchema.nullable()

export const productTemplateSchema = z.object({
  id: productTemplateIdSchema,
  name: z.string().min(1),
  description: z.string(),
  route: productStartPageSchema,
  previewUrl: httpUrl,
  screenshotUrl: httpUrl.nullable(),
  buildNumber: identifier.nullable(),
})

export const productCatalogResponseSchema = z.object({
  repository: repositorySchema,
  templates: z.array(productTemplateSchema),
  canCreate: z.boolean(),
})

export const productTemplateResponseSchema = z.object({
  repository: repositorySchema,
  template: productTemplateSchema,
  canCreate: z.boolean(),
  controlsIdentity: z.string().min(1).max(128).optional(),
})

export const productMetadataInputSchema = prototypeDetailsSchema
  .extend({ startPage: productStartPageSchema })
  .strict()

export const productCandidateSchema = z.object({
  id: identifier,
  branchName: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  startPage: productStartPageSchema,
})

export const productManagementResponseSchema = z.object({
  repository: repositorySchema,
  registered: z.array(prototypeSchema.extend({ startPage: productStartPageSchema })),
  candidates: z.array(productCandidateSchema),
  canCreate: z.boolean(),
})

export const productShareLinkSchema = z.object({
  id: identifier,
  shareId: productShareIdSchema,
  repositoryId: recordIdentifierSchema,
  prototypeId: recordIdentifierSchema,
  buildNumber: identifier,
  label: z.string().min(1).max(100),
  createdBy: z.string().min(1),
  createdAt: timestamp,
  expiresAt: timestamp,
  revokedAt: timestamp.nullable(),
})

export const productShareInputSchema = z
  .object({
    label: z.string().trim().min(1, "Enter a link label.").max(100),
    expiration: z.enum(["one_day", "seven_days"]),
    buildNumber: identifier,
  })
  .strict()

export const productSharingResponseSchema = z.object({
  resource: prototypeResponseSchema,
  links: z.array(productShareLinkSchema),
  enabled: z.boolean(),
  canManage: z.boolean(),
})

export const productSharingSettingsSchema = z.object({
  enabled: z.boolean(),
  canAdminister: z.boolean(),
  activeLinkCount: z.number().int().nonnegative(),
})

export const productSharingSettingsInputSchema = z
  .object({ operation: z.enum(["enable", "disable"]), confirmed: z.literal(true) })
  .strict()

export const productPublicResponseSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("active"),
    label: z.string().min(1),
    prototypeName: z.string().min(1),
    buildNumber: identifier,
    previewUrl: httpUrl,
    expiresAt: timestamp,
  }),
  z.object({
    state: z.enum(["expired", "revoked", "disabled"]),
    label: z.string().min(1),
  }),
])

export const productMutationResponseSchema = z.object({ notice: z.string().min(1) })
export const productLinkCreatedResponseSchema = productMutationResponseSchema.extend({
  link: productShareLinkSchema,
})
