import type {
  NormalizedJsonObject,
  NormalizedJsonValue,
  NormalizeSecretFreeJsonLimits,
} from "./types.ts"

const sensitiveExactNames = new Set(["apikey", "authorization", "cookie"])
const sensitiveNameSuffixes = [
  "accesstoken",
  "apikey",
  "clientkey",
  "clientsecret",
  "credential",
  "credentials",
  "idtoken",
  "keymaterial",
  "password",
  "passphrase",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "sessionid",
  "signingkey",
  "token",
]
const sensitiveValuePatterns = [
  new RegExp("-----BEGIN [A-Z0-9 ]*PRIVATE" + " KEY-----", "i"),
  /^(?:basic|bearer)\s+\S+/i,
  /\b(?:password|passphrase|secret|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[:=]\s*\S+/i,
  /\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_/-]{16,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
]

function compareOrdinal(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isSensitiveName(key: string) {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase()
  return (
    sensitiveExactNames.has(normalized) ||
    sensitiveNameSuffixes.some((suffix) => normalized.endsWith(suffix))
  )
}

function assertSafeString(value: string, maximum: number) {
  if (value.length > maximum) {
    throw new Error(`JSON string values cannot exceed ${maximum} characters.`)
  }
  if (sensitiveValuePatterns.some((pattern) => pattern.test(value))) {
    throw new Error("JSON values cannot contain credential or key material.")
  }
}

export function normalizeSecretFreeJson(
  value: unknown,
  limits: NormalizeSecretFreeJsonLimits,
): NormalizedJsonObject {
  let entries = 0

  function visit(item: unknown, depth: number): NormalizedJsonValue {
    if (depth > limits.maxDepth) {
      throw new Error(`JSON data cannot exceed ${limits.maxDepth} nested levels.`)
    }
    if (item === null || typeof item === "boolean") return item
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("JSON numbers must be finite.")
      return item
    }
    if (typeof item === "string") {
      assertSafeString(item, limits.maxStringLength)
      return item
    }
    if (Array.isArray(item)) {
      if (item.length > limits.maxArrayItems) {
        throw new Error(`JSON arrays cannot exceed ${limits.maxArrayItems} items.`)
      }
      entries += item.length
      if (entries > limits.maxEntries) {
        throw new Error(`JSON data cannot exceed ${limits.maxEntries} total entries.`)
      }
      return item.map((value) => visit(value, depth + 1))
    }
    if (typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) {
      throw new Error("JSON data must contain only plain objects, arrays, and scalar values.")
    }

    const objectEntries = Object.entries(item)
    if (objectEntries.length > limits.maxObjectFields) {
      throw new Error(`JSON objects cannot exceed ${limits.maxObjectFields} fields.`)
    }
    entries += objectEntries.length
    if (entries > limits.maxEntries) {
      throw new Error(`JSON data cannot exceed ${limits.maxEntries} total entries.`)
    }
    return Object.fromEntries(
      objectEntries
        .sort(([left], [right]) => compareOrdinal(left, right))
        .map(([key, child]) => {
          if (!key.length || key.length > limits.maxKeyLength) {
            throw new Error(
              `JSON keys must contain between 1 and ${limits.maxKeyLength} characters.`,
            )
          }
          if (isSensitiveName(key)) {
            throw new Error("JSON data cannot contain secret-bearing fields.")
          }
          return [key, visit(child, depth + 1)]
        }),
    )
  }

  const normalized = visit(value, 0)
  if (Array.isArray(normalized) || normalized === null || typeof normalized !== "object") {
    throw new Error("JSON data must be an object.")
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > limits.maxBytes) {
    throw new Error(`JSON data cannot exceed ${limits.maxBytes} bytes.`)
  }
  return normalized
}
