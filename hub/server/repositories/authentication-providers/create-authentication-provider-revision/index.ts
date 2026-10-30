import type {
  CreateAuthenticationProviderRevisionDatabase,
  CreateAuthenticationProviderRevisionInput,
} from "./types.ts"

export function createAuthenticationProviderRevision(
  database: CreateAuthenticationProviderRevisionDatabase,
  input: CreateAuthenticationProviderRevisionInput,
) {
  return database.authenticationProviderRevision.create({ data: input })
}
