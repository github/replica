import { Prisma } from "../../generated/prisma/client.ts"

export type PrismaTransactionErrorClassification = "retryable" | "terminal" | "unknown"

export function classifyPrismaTransactionError(
  error: unknown,
): PrismaTransactionErrorClassification {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return "unknown"
  if (["P2002", "P2034"].includes(error.code)) return "retryable"
  return "terminal"
}
