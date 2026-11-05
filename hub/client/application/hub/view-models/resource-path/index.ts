export function resourcePath(
  pathname: string,
  search: URLSearchParams,
  values: Record<string, string | number | null> = {},
) {
  const fragmentIndex = pathname.indexOf("#")
  const fragment = fragmentIndex === -1 ? "" : pathname.slice(fragmentIndex)
  const destination = fragmentIndex === -1 ? pathname : pathname.slice(0, fragmentIndex)
  const queryIndex = destination.indexOf("?")
  const path = queryIndex === -1 ? destination : destination.slice(0, queryIndex)
  const query = new URLSearchParams(queryIndex === -1 ? "" : destination.slice(queryIndex + 1))
  const scenario = search.get("mockScenario")
  if (scenario) query.set("mockScenario", scenario)

  for (const [key, value] of Object.entries(values)) {
    if (value !== null) query.set(key, String(value))
  }

  return `${path}${query.size ? `?${query}` : ""}${fragment}`
}
