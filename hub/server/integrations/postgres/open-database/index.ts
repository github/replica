import { Pool } from "pg"

export function openDatabase(databaseUrl: string) {
  return new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  })
}
