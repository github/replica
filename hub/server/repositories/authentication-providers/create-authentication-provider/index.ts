import type {
  CreateAuthenticationProviderDatabase,
  CreateAuthenticationProviderInput,
} from "./types.ts"

export function createAuthenticationProvider(
  database: CreateAuthenticationProviderDatabase,
  input: CreateAuthenticationProviderInput,
) {
  return database.authenticationProvider.create({ data: input })
}
