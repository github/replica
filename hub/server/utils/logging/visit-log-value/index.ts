import {
  maxLogDepth,
  maxLogEntries,
  maxLogKeyLength,
  maxLogStringLength,
  sensitiveLogKeyPattern,
  truncationMarker,
} from "../sanitize-log-value/constants.ts"
import type { LogValue } from "../sanitize-log-value/types.ts"

import type { LogTraversal } from "./types.ts"

/** Share traversal limits across containers without invoking getters or toJSON(). */
export function visitLogValue(input: unknown, depth: number, traversal: LogTraversal): LogValue {
  if (typeof input === "string") {
    return input.length > maxLogStringLength
      ? `${input.slice(0, maxLogStringLength - truncationMarker.length)}${truncationMarker}`
      : input
  }
  if (input === null || typeof input === "boolean") return input
  if (typeof input === "number") return Number.isFinite(input) ? input : "[NON-FINITE]"
  if (typeof input !== "object") return "[UNSUPPORTED]"
  if (traversal.ancestors.has(input)) return "[CIRCULAR]"
  if (depth >= maxLogDepth) return "[MAX DEPTH]"
  if (
    !Array.isArray(input) &&
    !(input instanceof Error) &&
    Object.getPrototypeOf(input) !== Object.prototype &&
    Object.getPrototypeOf(input) !== null
  ) {
    return "[UNSUPPORTED OBJECT]"
  }

  traversal.ancestors.add(input)
  const output = Object.create(null) as Record<string, LogValue>
  const array: LogValue[] = []
  if (input instanceof Error) output.type = "Error"
  const keys = input instanceof Error ? ["name", "message", "stack", "code"] : Object.keys(input)
  for (const key of keys) {
    if (++traversal.entries > maxLogEntries) {
      if (Array.isArray(input)) array.push("[MAX ENTRIES]")
      else output[truncationMarker] = "[MAX ENTRIES]"
      break
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor) continue
    let result: LogValue
    if (sensitiveLogKeyPattern.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      result = "[REDACTED]"
    } else if ("value" in descriptor) {
      result = visitLogValue(descriptor.value, depth + 1, traversal)
    } else {
      result = "[UNAVAILABLE]"
    }
    if (Array.isArray(input)) array.push(result)
    else
      output[
        key.length > maxLogKeyLength
          ? `${key.slice(0, maxLogKeyLength - truncationMarker.length)}${truncationMarker}`
          : key
      ] = result
  }
  traversal.ancestors.delete(input)
  return Array.isArray(input) ? array : output
}
