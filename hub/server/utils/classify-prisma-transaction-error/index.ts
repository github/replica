import { Prisma } from "../../generated/prisma/client.ts"

export type PrismaTransactionErrorClassification = "retryable" | "terminal" | "unknown"

export function classifyPrismaTransactionError(
  error: unknown,
): PrismaTransactionErrorClassification {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2034"].includes(error.code)) return "retryable"
    if (
      error.code === "P2010" &&
      error.meta !== undefined &&
      typeof error.meta === "object" &&
      "code" in error.meta &&
      error.meta.code === "40001"
    ) {
      return "retryable"
    }
    return "terminal"
  }
  if (
    error !== null &&
    typeof error === "object" &&
    "cause" in error &&
    error.cause !== null &&
    typeof error.cause === "object" &&
    "originalCode" in error.cause &&
    error.cause.originalCode === "40001"
  ) {
    return "retryable"
  }
  return "unknown"
}
