export function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export function canonicalDeclaration(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalDeclaration).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalDeclaration(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export function conditionMatches(condition, values) {
  if (!condition) return true
  if (condition.all) return condition.all.every((child) => conditionMatches(child, values))
  if (condition.any) return condition.any.some((child) => conditionMatches(child, values))
  const value = values[condition.control]
  if ("equals" in condition) return value === condition.equals
  if ("in" in condition) return condition.in.includes(value)
  return Array.isArray(value) && value.includes(condition.includes)
}
