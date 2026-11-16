export function parseHttpsOrigin(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length > 500) return undefined
  const url = URL.parse(value)
  return url?.protocol === "https:" && url.origin === value ? url : undefined
}
