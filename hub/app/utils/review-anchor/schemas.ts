import { z } from "zod"

import { createByteLimitedStringSchema } from "@utils/create-byte-limited-string-schema"

import {
  ACCESSIBLE_NAME_MAXIMUM_BYTES,
  ANCHOR_SCHEMA_VERSION,
  ANCHOR_MAXIMUM_BYTES,
  AREA_ELEMENTS_MAXIMUM,
  AREA_MINIMUM_DIAGONAL,
  AREA_PATH_MAXIMUM_POINTS,
  AREA_ROLE_MAXIMUM_BYTES,
  AREA_TEXT_EXCERPT_MAXIMUM_BYTES,
  GEOMETRY_ABSOLUTE_MAXIMUM,
  HASH_MAXIMUM_BYTES,
  PATHNAME_MAXIMUM_BYTES,
  SEARCH_MAXIMUM_BYTES,
  SELECTED_TEXT_MAXIMUM_BYTES,
  SELECTOR_MAXIMUM_BYTES,
  TAG_NAME_MAXIMUM_BYTES,
  VIEWPORT_DIMENSION_MAXIMUM,
} from "./constants"

const TEXT_ENCODER = new TextEncoder()
const NONNEGATIVE_POSITION_SCHEMA = z.number().min(0).max(GEOMETRY_ABSOLUTE_MAXIMUM)
const POSITION_SCHEMA = z.number().min(-GEOMETRY_ABSOLUTE_MAXIMUM).max(GEOMETRY_ABSOLUTE_MAXIMUM)
const DIMENSION_SCHEMA = z.number().min(0).max(GEOMETRY_ABSOLUTE_MAXIMUM)
const NORMALIZED_POINT_SCHEMA = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()

export const REVIEW_ROUTE_SCHEMA = z
  .object({
    pathname: createByteLimitedStringSchema(PATHNAME_MAXIMUM_BYTES, {
      prefix: "/",
      required: true,
    }),
    search: createByteLimitedStringSchema(SEARCH_MAXIMUM_BYTES, { prefix: "?" }),
    hash: createByteLimitedStringSchema(HASH_MAXIMUM_BYTES, { prefix: "#" }),
  })
  .strict()

export const ANCHOR_RECTANGLE_SCHEMA = z
  .object({
    x: NONNEGATIVE_POSITION_SCHEMA,
    y: NONNEGATIVE_POSITION_SCHEMA,
    width: DIMENSION_SCHEMA,
    height: DIMENSION_SCHEMA,
  })
  .strict()

export const ANCHOR_POINT_SCHEMA = z
  .object({
    x: POSITION_SCHEMA,
    y: POSITION_SCHEMA,
  })
  .strict()

export const ANCHOR_VIEWPORT_SCHEMA = z
  .object({
    width: z.number().min(1).max(VIEWPORT_DIMENSION_MAXIMUM),
    height: z.number().min(1).max(VIEWPORT_DIMENSION_MAXIMUM),
    scrollX: NONNEGATIVE_POSITION_SCHEMA,
    scrollY: NONNEGATIVE_POSITION_SCHEMA,
  })
  .strict()

export const ELEMENT_ANCHOR_SCHEMA = z
  .object({
    schemaVersion: z.literal(ANCHOR_SCHEMA_VERSION),
    kind: z.literal("element"),
    route: REVIEW_ROUTE_SCHEMA,
    selector: createByteLimitedStringSchema(SELECTOR_MAXIMUM_BYTES, { required: true }),
    accessibleName: createByteLimitedStringSchema(ACCESSIBLE_NAME_MAXIMUM_BYTES),
    tagName: createByteLimitedStringSchema(TAG_NAME_MAXIMUM_BYTES, { required: true }).regex(
      /^[a-z][a-z0-9-]*$/,
    ),
    selectedText: createByteLimitedStringSchema(SELECTED_TEXT_MAXIMUM_BYTES),
    rect: ANCHOR_RECTANGLE_SCHEMA,
    viewport: ANCHOR_VIEWPORT_SCHEMA,
    elementOffset: NORMALIZED_POINT_SCHEMA,
  })
  .strict()
  .refine((anchor) => TEXT_ENCODER.encode(JSON.stringify(anchor)).length <= ANCHOR_MAXIMUM_BYTES)

export const AREA_ELEMENT_CONTEXT_SCHEMA = z
  .object({
    selector: createByteLimitedStringSchema(SELECTOR_MAXIMUM_BYTES, { required: true }),
    accessibleName: createByteLimitedStringSchema(ACCESSIBLE_NAME_MAXIMUM_BYTES),
    tagName: createByteLimitedStringSchema(TAG_NAME_MAXIMUM_BYTES, { required: true }).regex(
      /^[a-z][a-z0-9-]*$/,
    ),
    role: createByteLimitedStringSchema(AREA_ROLE_MAXIMUM_BYTES),
    textExcerpt: createByteLimitedStringSchema(AREA_TEXT_EXCERPT_MAXIMUM_BYTES),
    rect: ANCHOR_RECTANGLE_SCHEMA,
  })
  .strict()

export const AREA_ANCHOR_SCHEMA = z
  .object({
    schemaVersion: z.literal(ANCHOR_SCHEMA_VERSION),
    kind: z.literal("area"),
    route: REVIEW_ROUTE_SCHEMA,
    path: z.array(NORMALIZED_POINT_SCHEMA).min(2).max(AREA_PATH_MAXIMUM_POINTS),
    rect: ANCHOR_RECTANGLE_SCHEMA,
    viewport: ANCHOR_VIEWPORT_SCHEMA,
    elements: z.array(AREA_ELEMENT_CONTEXT_SCHEMA).max(AREA_ELEMENTS_MAXIMUM),
  })
  .strict()
  .refine((anchor) => Math.hypot(anchor.rect.width, anchor.rect.height) >= AREA_MINIMUM_DIAGONAL)
  .refine((anchor) => TEXT_ENCODER.encode(JSON.stringify(anchor)).length <= ANCHOR_MAXIMUM_BYTES)

export const REVIEW_ANCHOR_SCHEMA = z.discriminatedUnion("kind", [
  ELEMENT_ANCHOR_SCHEMA,
  AREA_ANCHOR_SCHEMA,
])

export const ANCHOR_RESOLUTION_SCHEMA = z.discriminatedUnion("status", [
  z
    .object({
      commentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      status: z.enum(["resolved", "moved"]),
      rect: z
        .object({
          x: POSITION_SCHEMA,
          y: POSITION_SCHEMA,
          width: DIMENSION_SCHEMA,
          height: DIMENSION_SCHEMA,
        })
        .strict(),
      point: z
        .object({
          x: POSITION_SCHEMA,
          y: POSITION_SCHEMA,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      commentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      status: z.enum(["changed", "missing", "route-mismatch"]),
    })
    .strict(),
])
