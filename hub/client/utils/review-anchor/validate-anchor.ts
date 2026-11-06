import { REVIEW_ANCHOR_SCHEMA } from "./schemas"

export function validateAnchor(value: unknown) {
  return REVIEW_ANCHOR_SCHEMA.parse(value)
}
