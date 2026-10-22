export function readHubError(value) {
  return value instanceof Error ? value : new Error(String(value))
}
