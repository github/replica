import { Buffer } from "node:buffer"

import type { LogValue } from "./types.ts"

export function sanitizeLogValue(value: unknown): LogValue {
  const ancestors = new WeakSet<object>()
  const truncated = "[TRUNCATED]"
  let entries = 0

  function visit(input: unknown, depth: number): LogValue {
    if (typeof input === "string") {
      return input.length > 2048 ? `${input.slice(0, 2048 - truncated.length)}${truncated}` : input
    }
    if (input === null || typeof input === "boolean") return input
    if (typeof input === "number") return Number.isFinite(input) ? input : "[NON-FINITE]"
    if (typeof input !== "object") return "[UNSUPPORTED]"
    if (ancestors.has(input)) return "[CIRCULAR]"
    if (depth >= 6) return "[MAX DEPTH]"
    if (
      !Array.isArray(input) &&
      !(input instanceof Error) &&
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    ) {
      return "[UNSUPPORTED OBJECT]"
    }

    ancestors.add(input)
    const output = Object.create(null) as Record<string, LogValue>
    const array: LogValue[] = []
    if (input instanceof Error) output.type = "Error"
    const keys = input instanceof Error ? ["name", "message", "stack", "code"] : Object.keys(input)
    for (const key of keys) {
      if (++entries > 100) {
        if (Array.isArray(input)) array.push("[MAX ENTRIES]")
        else output["[TRUNCATED]"] = "[MAX ENTRIES]"
        break
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor) continue
      let result: LogValue
      if (
        /(password|passwd|passphrase|secret|token|authorization|cookie|apikey|privatekey|sessionid)/.test(
          key.toLowerCase().replace(/[^a-z0-9]/g, ""),
        )
      ) {
        result = "[REDACTED]"
      } else if (descriptor && "value" in descriptor) {
        result = visit(descriptor.value, depth + 1)
      } else {
        result = "[UNAVAILABLE]"
      }
      if (Array.isArray(input)) array.push(result)
      else
        output[key.length > 128 ? `${key.slice(0, 128 - truncated.length)}${truncated}` : key] =
          result
    }
    ancestors.delete(input)
    return Array.isArray(input) ? array : output
  }

  const result = visit(value, 0)
  return Buffer.byteLength(JSON.stringify(result)) <= 8192 ? result : "[OMITTED: MAX BYTES]"
}
