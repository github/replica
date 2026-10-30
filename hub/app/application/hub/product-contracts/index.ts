import { z } from "zod"

import {
  prototypeDetailsSchema,
  prototypeResponseSchema,
  prototypeSchema,
  repositorySchema,
} from "../contracts"

const identifier = z.number().int().positive()
const httpUrl = z.url({ protocol: /^https?$/ })
const timestamp = z.iso.datetime({ offset: true })

export const productTemplateIdSchema = z.string().regex(/^(?:default|prototype-[1-9]\d*)$/)
export const productShareIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
export const productStartPageSchema = z
  .string()
  .trim()
  .max(2048, "Use at most 2,048 characters for the start page.")
  .refine((value) => {
    if (!value) return true
    try {
      const decoded = decodeURIComponent(value)
      const url = new URL(value, "http://preview.invalid")
      return (
        value.startsWith("/") &&
        !decoded.startsWith("//") &&
        !/[\s\\\p{Cc}]/u.test(decoded) &&
        url.origin === "http://preview.invalid"
      )
    } catch {
      return false
    }
  }, "Enter a local route beginning with /, not an external URL.")
  .nullable()

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
})

export const productCreateInputSchema = z
  .object({
    brief: z.string().trim().min(1, "Describe the prototype.").max(4000),
    description: z.string().trim().max(4000),
    templateId: productTemplateIdSchema,
  })
  .strict()

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
  repositoryId: identifier,
  prototypeId: identifier,
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
export const productCreatedResponseSchema = productMutationResponseSchema.extend({
  resource: prototypeResponseSchema,
})
export const productLinkCreatedResponseSchema = productMutationResponseSchema.extend({
  link: productShareLinkSchema,
})

export type ProductTemplate = z.infer<typeof productTemplateSchema>
export type ProductCatalogResponse = z.infer<typeof productCatalogResponseSchema>
export type ProductTemplateResponse = z.infer<typeof productTemplateResponseSchema>
export type ProductCreateInput = z.infer<typeof productCreateInputSchema>
export type ProductMetadataInput = z.infer<typeof productMetadataInputSchema>
export type ProductManagementResponse = z.infer<typeof productManagementResponseSchema>
export type ProductShareLink = z.infer<typeof productShareLinkSchema>
export type ProductShareInput = z.infer<typeof productShareInputSchema>
export type ProductSharingResponse = z.infer<typeof productSharingResponseSchema>
export type ProductSharingSettings = z.infer<typeof productSharingSettingsSchema>
export type ProductSharingSettingsInput = z.infer<typeof productSharingSettingsInputSchema>
export type ProductPublicResponse = z.infer<typeof productPublicResponseSchema>
export type ProductActionResult =
  { saved: true; notice: string; prototypePath?: string } | { saved: false; error: string }
