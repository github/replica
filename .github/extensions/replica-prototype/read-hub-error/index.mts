export type HubError = Error & {
  statusCode?: unknown
  code?: unknown
  registrationReason?: unknown
  deliveryPhase?: "before_dispatch" | "after_dispatch"
}

export function readHubError(value: unknown): HubError {
  return value instanceof Error ? value : new Error(String(value))
}
