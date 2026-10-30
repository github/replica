import { z } from "zod"

import { createByteLimitedStringSchema } from "@utils/create-byte-limited-string-schema"
import {
  ANCHOR_RESOLUTION_SCHEMA,
  AREA_ANCHOR_SCHEMA,
  ELEMENT_ANCHOR_SCHEMA,
  REVIEW_ROUTE_SCHEMA,
} from "@utils/review-anchor/schemas"

import {
  PREVIEW_BRIDGE_ANCHORS_PER_MESSAGE,
  PREVIEW_BRIDGE_PROTOCOL_VERSION,
  PREVIEW_BRIDGE_REQUEST_ID_MAXIMUM_BYTES,
} from "./constants"

const MESSAGE_FIELDS = {
  protocolVersion: z.literal(PREVIEW_BRIDGE_PROTOCOL_VERSION),
  requestId: createByteLimitedStringSchema(PREVIEW_BRIDGE_REQUEST_ID_MAXIMUM_BYTES, {
    required: true,
  }),
}

export const PREVIEW_BRIDGE_MESSAGE_SCHEMA = z.discriminatedUnion("type", [
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:conversation-dismiss-requested"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:ready"),
      payload: z.object({ route: REVIEW_ROUTE_SCHEMA }).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:route-changed"),
      payload: z.object({ route: REVIEW_ROUTE_SCHEMA }).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:element-selected"),
      payload: z.object({ anchor: ELEMENT_ANCHOR_SCHEMA }).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:area-selected"),
      payload: z.object({ anchor: AREA_ANCHOR_SCHEMA }).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:element-selection-requested"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:area-selection-requested"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:sidebar-toggle-requested"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:selection-cancelled"),
      payload: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:selection-failed"),
      payload: z
        .object({
          reason: z.enum(["element-unavailable", "area-too-small", "area-unavailable"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:anchors-resolved"),
      payload: z
        .object({
          results: z.array(ANCHOR_RESOLUTION_SCHEMA).max(PREVIEW_BRIDGE_ANCHORS_PER_MESSAGE),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...MESSAGE_FIELDS,
      type: z.literal("replica:bridge:anchor-focused"),
      payload: z.object({ result: ANCHOR_RESOLUTION_SCHEMA }).strict(),
    })
    .strict(),
])
