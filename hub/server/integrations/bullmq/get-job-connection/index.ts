import { z } from "zod"

const databaseUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return ["postgres:", "postgresql:"].includes(url.protocol) && url.pathname.length > 1
}, "Job connections require a PostgreSQL database URL.")

/** Leave pool ownership with BullMQ, including its dedicated notification connection. */
export function getJobConnection(databaseUrl: string) {
  return {
    connectionString: databaseUrlSchema.parse(databaseUrl),
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    application_name: "replica-hub-jobs",
  }
}
