import { AuthenticationError } from "#server/utils/authentication-error"
import { secretsMatch } from "#server/utils/secrets-match"

export function requireCsrfToken(cookieToken: string, headerToken: string): void {
  if (!cookieToken || !secretsMatch(cookieToken, headerToken)) {
    throw new AuthenticationError(403, "csrf_failed", "The CSRF token did not match.")
  }
}
