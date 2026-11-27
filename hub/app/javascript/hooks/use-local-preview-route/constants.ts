import { z } from "zod"

import { createByteLimitedStringSchema } from "@utils/create-byte-limited-string-schema"

export const MAXIMUM_PREVIEW_URL_LENGTH = 14_000

export const PREVIEW_ROUTE_SCHEMA = z
  .object({
    pathname: createByteLimitedStringSchema(MAXIMUM_PREVIEW_URL_LENGTH, {
      prefix: "/",
      required: true,
    }),
    search: createByteLimitedStringSchema(MAXIMUM_PREVIEW_URL_LENGTH, { prefix: "?" }),
    hash: createByteLimitedStringSchema(MAXIMUM_PREVIEW_URL_LENGTH, { prefix: "#" }),
  })
  .strict()
