import type { CreateExternalIdentityDatabase, CreateExternalIdentityInput } from "./types.ts"

export function createExternalIdentity(
  database: CreateExternalIdentityDatabase,
  input: CreateExternalIdentityInput,
) {
  return database.externalIdentity.create({ data: input })
}
