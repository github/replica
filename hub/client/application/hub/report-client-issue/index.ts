export function reportClientIssue(message: string) {
  console.warn(message)
  window.dispatchEvent(new CustomEvent("replica:client-issue", { detail: message }))
}
