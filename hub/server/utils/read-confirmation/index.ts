export function readConfirmation(body: unknown): boolean {
  return typeof body === "object" && body !== null && "confirmed" in body && body.confirmed === true
}
