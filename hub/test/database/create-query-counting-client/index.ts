import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../../../server/generated/prisma/client.ts"

/** A test client that counts the SQL statements it sends, excluding transaction control. */
export function createQueryCountingClient() {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  })
  let statements = 0
  client.$on("query", (event) => {
    if (!/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(event.query.trim())) statements += 1
  })
  return {
    client,
    reset: () => {
      statements = 0
    },
    statements: () => statements,
  }
}
