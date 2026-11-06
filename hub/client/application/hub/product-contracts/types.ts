import type { z } from "zod"

import type {
  productCatalogResponseSchema,
  productManagementResponseSchema,
  productMetadataInputSchema,
  productPublicResponseSchema,
  productShareInputSchema,
  productShareLinkSchema,
  productSharingResponseSchema,
  productSharingSettingsInputSchema,
  productSharingSettingsSchema,
  productTemplateResponseSchema,
  productTemplateSchema,
} from "."

export type ProductTemplate = z.infer<typeof productTemplateSchema>
export type ProductCatalogResponse = z.infer<typeof productCatalogResponseSchema>
export type ProductTemplateResponse = z.infer<typeof productTemplateResponseSchema>
export type ProductMetadataInput = z.infer<typeof productMetadataInputSchema>
export type ProductManagementResponse = z.infer<typeof productManagementResponseSchema>
export type ProductShareLink = z.infer<typeof productShareLinkSchema>
export type ProductShareInput = z.infer<typeof productShareInputSchema>
export type ProductSharingResponse = z.infer<typeof productSharingResponseSchema>
export type ProductSharingSettings = z.infer<typeof productSharingSettingsSchema>
export type ProductSharingSettingsInput = z.infer<typeof productSharingSettingsInputSchema>
export type ProductPublicResponse = z.infer<typeof productPublicResponseSchema>
export type ProductActionResult = { saved: true; notice: string } | { saved: false; error: string }
