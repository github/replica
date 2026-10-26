import { digestSecret } from "#server/utils/digest-secret"

export function createCsrfToken(token: string): string {
  return digestSecret(`csrf:${token}`)
}
