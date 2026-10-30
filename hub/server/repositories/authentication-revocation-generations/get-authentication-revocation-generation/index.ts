import type { Prisma } from "../../../generated/prisma/client.ts"

export async function getAuthenticationRevocationGeneration(
  database: Pick<Prisma.TransactionClient, "authenticationRevocationGeneration">,
): Promise<bigint> {
  const record = await database.authenticationRevocationGeneration.findUnique({
    where: { key: "global" },
  })
  if (!record) throw new Error("The global authentication revocation generation is missing.")
  return record.generation
}
