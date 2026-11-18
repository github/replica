export type EnvironmentChange = { key: string; outcome: "added" | "kept" }

function escape(key: string) {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Matches the assignment forms dotenv accepts: optional `export`, `=` with spaces, or `: `. */
function assignments(key: string) {
  return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${escape(key)}(?:[ \\t]*=|:[ \\t])(.*)$`, "gm")
}

function placeholder(key: string) {
  return new RegExp(`^#[ \\t]*(?:export[ \\t]+)?${escape(key)}[ \\t]*[=:].*$`, "m")
}

function hasValue(raw: string) {
  const value = raw.trim()
  const quoted = /^(['"`])([\s\S]*?)\1/.exec(value)
  if (quoted) return quoted[2]!.trim() !== ""
  return value.replace(/#.*$/, "").trim() !== ""
}

/**
 * Fills missing environment values without replacing configured ones. Like dotenv, the last
 * assignment decides; an empty or commented assignment is filled in place, otherwise the value
 * is appended.
 */
export function updateEnvironmentFile(content: string, values: Record<string, string>) {
  const changes: EnvironmentChange[] = []
  let next = content
  for (const [key, value] of Object.entries(values)) {
    const last = [...next.matchAll(assignments(key))].at(-1)
    if (last && hasValue(last[1]!)) {
      changes.push({ key, outcome: "kept" })
      continue
    }
    const line = `${key}=${value}`
    const match = last ?? placeholder(key).exec(next)
    next = match
      ? `${next.slice(0, match.index)}${line}${next.slice(match.index + match[0].length)}`
      : `${next}${next === "" || next.endsWith("\n") ? "" : "\n"}${line}\n`
    changes.push({ key, outcome: "added" })
  }
  return { content: next, changes }
}
