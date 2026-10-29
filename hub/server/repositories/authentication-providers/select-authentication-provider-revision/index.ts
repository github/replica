import type {
  SelectAuthenticationProviderRevisionDatabase,
  SelectAuthenticationProviderRevisionInput,
} from "./types.ts"

export function selectAuthenticationProviderRevision(
  database: SelectAuthenticationProviderRevisionDatabase,
  input: SelectAuthenticationProviderRevisionInput,
) {
  return database.authenticationProvider.update({
    where: { id: input.providerId },
    data: { selectedRevisionId: input.revisionId },
  })
}
