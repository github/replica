import type { FindAuthenticationProviderDatabase } from "./types.ts"

export function findAuthenticationProvider(
  database: FindAuthenticationProviderDatabase,
  key: string,
) {
  return database.authenticationProvider.findUnique({
    where: { key },
    include: { selectedRevision: true },
  })
}
