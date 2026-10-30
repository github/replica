import type { Prisma } from "../../../generated/prisma/client.ts"

export function findAdmissionHandoff(
  database: Pick<Prisma.TransactionClient, "admissionHandoff">,
  tokenDigest: string,
) {
  return database.admissionHandoff.findUnique({ where: { tokenDigest } })
}
