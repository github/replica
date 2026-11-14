// Keeps final failure output short; full details stay in memory for the recovery menu.
export function tailLines(text: string, { lines = 20, characters = 4_000 } = {}) {
  const all = text.trimEnd().split("\n")
  const tail = all.slice(-lines).join("\n")
  if (tail.length > characters) return `…${tail.slice(-characters)}`
  return all.length > lines ? `…\n${tail}` : tail
}
