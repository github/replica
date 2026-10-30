import { readControlQuery } from "../read-control-query"
import { encodeControlValues } from "../encode-control-values"

export function withControlQuery(address: string, query: string): string {
  const url = new URL(address, window.location.href)
  const parsed = readControlQuery(query)
  if (parsed.notice) throw new Error(parsed.notice)
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("rc.")) url.searchParams.delete(key)
  for (const [key, value] of new URLSearchParams(encodeControlValues(parsed.scopes)))
    url.searchParams.set(key, value)
  return url.toString()
}
