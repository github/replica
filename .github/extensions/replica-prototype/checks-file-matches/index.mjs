export function matchesCheckFile(pattern, name) {
  const expression = pattern
    .split(/(\*\*\/|\*\*|\*)/)
    .map((piece) =>
      piece === "**/"
        ? "(?:.*/)?"
        : piece === "**"
          ? ".*"
          : piece === "*"
            ? "[^/]*"
            : piece.replace(/[.+^$()|\\]/g, "\\$&"),
    )
    .join("")
  return new RegExp(`^${expression}$`).test(name)
}
