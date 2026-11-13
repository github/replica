export type EnvironmentChange = { key: string; outcome: "added" | "kept" }

function configured(key: string) {
  return new RegExp(`^${key}=[ \\t]*\\S`, "m")
}

function placeholder(key: string) {
  return new RegExp(`^(?:#[ \\t]*)?${key}=.*$`, "m")
}

/**
 * Fills missing environment values without replacing configured ones. An empty or
 * commented assignment is treated as missing and filled in place; otherwise the value is appended.
 */
export function updateEnvironmentFile(content: string, values: Record<string, string>) {
  const changes: EnvironmentChange[] = []
  let next = content
  for (const [key, value] of Object.entries(values)) {
    if (configured(key).test(next)) {
      changes.push({ key, outcome: "kept" })
      continue
    }
    const line = `${key}=${value}`
    const match = placeholder(key).exec(next)
    next = match
      ? `${next.slice(0, match.index)}${line}${next.slice(match.index + match[0].length)}`
      : `${next}${next === "" || next.endsWith("\n") ? "" : "\n"}${line}\n`
    changes.push({ key, outcome: "added" })
  }
  return { content: next, changes }
}
