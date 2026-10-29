import type { CreateUserDatabase, CreateUserInput } from "./types.ts"

export function createUser(database: CreateUserDatabase, input: CreateUserInput) {
  return database.user.create({ data: input })
}
