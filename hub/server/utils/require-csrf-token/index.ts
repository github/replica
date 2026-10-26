import { createCsrfToken } from "#server/utils/create-csrf-token"
import { IdentityError } from "#server/utils/identity-error"
import { secretsMatch } from "#server/utils/secrets-match"

export function requireCsrfToken(token: string, csrfToken: string): void {
  if (!secretsMatch(csrfToken, createCsrfToken(token))) {
    throw new IdentityError(403, "csrf_failed", "Reload Hub before submitting this request.")
  }
}
