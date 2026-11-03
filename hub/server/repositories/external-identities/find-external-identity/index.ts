import type { ExternalIdentityTuple, FindExternalIdentityDatabase } from "./types.ts"

export function findExternalIdentity(
  database: FindExternalIdentityDatabase,
  tuple: ExternalIdentityTuple,
) {
  return database.externalIdentity.findUnique({
    where: { provider_issuer_subject: tuple },
  })
}
