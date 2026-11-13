import { z } from "zod"

import { ReviewCommentError } from "../errors.ts"
import type { ReviewAnchor } from "../types.ts"

function byteString(maximumBytes: number, required = false, prefix?: string) {
  return z.string().superRefine((value, context) => {
    if (required && !value.trim()) context.addIssue({ code: "custom", message: "cannot be blank" })
    if (Buffer.byteLength(value, "utf8") > maximumBytes) {
      context.addIssue({ code: "custom", message: `must be ${maximumBytes} UTF-8 bytes or fewer` })
    }
    if (prefix && value && !value.startsWith(prefix)) {
      context.addIssue({ code: "custom", message: `must start with ${prefix}` })
    }
  })
}

const coordinate = z.number().min(0).max(1_000_000)
const ratio = z.number().min(0).max(1)
const rect = z
  .object({ x: coordinate, y: coordinate, width: coordinate, height: coordinate })
  .strict()
const route = z
  .object({
    pathname: byteString(2_048, true, "/"),
    search: byteString(2_048, false, "?"),
    hash: byteString(1_024, false, "#"),
  })
  .strict()
const viewport = z
  .object({
    width: z.number().min(1).max(100_000),
    height: z.number().min(1).max(100_000),
    scrollX: coordinate,
    scrollY: coordinate,
  })
  .strict()
const tagName = byteString(64, true).regex(/^[a-z][a-z0-9-]*$/)

const elementAnchor = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("element"),
    route,
    selector: byteString(4_096, true),
    accessibleName: byteString(1_000),
    tagName,
    selectedText: byteString(2_000),
    rect,
    viewport,
    elementOffset: z.object({ x: ratio, y: ratio }).strict(),
  })
  .strict()

const areaElement = z
  .object({
    selector: byteString(4_096, true),
    accessibleName: byteString(1_000),
    tagName,
    role: byteString(64),
    textExcerpt: byteString(500),
    rect,
  })
  .strict()

const areaAnchor = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("area"),
    route,
    path: z
      .array(z.object({ x: ratio, y: ratio }).strict())
      .min(2)
      .max(160),
    rect,
    viewport,
    elements: z.array(areaElement).max(8),
  })
  .strict()
  .superRefine((value, context) => {
    if (Math.hypot(value.rect.width, value.rect.height) < 8) {
      context.addIssue({
        code: "custom",
        path: ["rect"],
        message: "diagonal must be at least 8 pixels",
      })
    }
  })

const anchorSchema = z.union([elementAnchor, areaAnchor])

export function parseReviewAnchor(value: unknown): ReviewAnchor {
  const parsed = anchorSchema.safeParse(value)
  if (!parsed.success) {
    throw new ReviewCommentError("invalid", "The review comment anchor is invalid.")
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > 16_384) {
    throw new ReviewCommentError(
      "invalid",
      "The review comment anchor must be 16384 UTF-8 bytes or fewer.",
    )
  }
  return parsed.data
}
