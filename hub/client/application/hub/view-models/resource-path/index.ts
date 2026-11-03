export function resourcePath(
  pathname: string,
  search: URLSearchParams,
  values: Record<string, string | number | null> = {},
) {
  const query = new URLSearchParams()
  const scenario = search.get("mockScenario")
  if (scenario) query.set("mockScenario", scenario)

  for (const [key, value] of Object.entries(values)) {
    if (value !== null) query.set(key, String(value))
  }

  return query.size ? `${pathname}?${query}` : pathname
}
