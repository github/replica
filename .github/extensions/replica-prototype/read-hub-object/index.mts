export function readHubObject(value: unknown): Record<string, unknown> | undefined {
  if (isObject(value)) return value
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}
