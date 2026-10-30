import { z } from "zod"

import type { ByteLimitedStringSchemaOptions } from "./types"

const TEXT_ENCODER = new TextEncoder()

export function createByteLimitedStringSchema(
  maximumBytes: number,
  { prefix, required = false }: ByteLimitedStringSchemaOptions = {},
) {
  return z
    .string()
    .refine(
      (value) =>
        (!required || value !== "") &&
        (!prefix || value === "" || value.startsWith(prefix)) &&
        TEXT_ENCODER.encode(value).length <= maximumBytes,
    )
}
