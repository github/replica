export function validControlsScopeErrors(
  value: unknown,
): value is readonly { scope: string; error: string }[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (issue: unknown) =>
        issue !== null &&
        typeof issue === "object" &&
        !Array.isArray(issue) &&
        "scope" in issue &&
        typeof issue.scope === "string" &&
        issue.scope.length > 0 &&
        issue.scope.length <= 64 &&
        "error" in issue &&
        typeof issue.error === "string" &&
        issue.error.length > 0 &&
        issue.error.length <= 500,
    )
  )
}
