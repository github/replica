import type { JsonValue } from "./types"

/** Renders a local example without putting submitted credentials into the sample. */
export function previewCustomBody(template: string, secretValues: string[]): string | null {
  const fields: Record<string, JsonValue> = {
    event_id: "00000000-0000-4000-8000-000000000001",
    event_name: "prototype_registered",
    occurred_at: "2026-01-01T12:00:00.000000Z",
    actor_id: "example-actor",
    repository_id: 2001,
    prototype_id: 3001,
    build_id: null,
    thread_id: null,
    comment_id: null,
    properties: { prototype_id: 3001 },
  }
  const secrets = secretValues.filter(Boolean).sort((a, b) => b.length - a.length)

  function redact(text: string): string {
    return secrets.reduce((result, secret) => result.replaceAll(secret, "[redacted]"), text)
  }

  function render(value: JsonValue): JsonValue {
    if (typeof value === "string") return redact(value)
    if (Array.isArray(value)) return value.map(render)
    if (value && typeof value === "object") {
      if ("$secret" in value) return "[redacted]"
      if ("$field" in value) {
        const field = value.$field
        if (typeof field !== "string" || !Object.hasOwn(fields, field)) return "[redacted]"
        const sample = fields[field]
        return sample === null && "when_missing" in value
          ? render(value.when_missing)
          : (sample ?? null)
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [redact(key), render(item)]),
      )
    }
    return value
  }

  try {
    return JSON.stringify(render(JSON.parse(template) as JsonValue), null, 2) ?? null
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RangeError) return null
    throw error
  }
}
