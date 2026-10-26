import { IdentityError } from "#server/utils/identity-error"

export function requireHubOrigin(origin: string, requestOrigin: string | undefined): void {
  if (requestOrigin !== origin) {
    throw new IdentityError(
      403,
      "origin_denied",
      "Submit this request from the configured Hub origin.",
    )
  }
}
