import { Prisma } from "../../../generated/prisma/client.ts"

export type PrismaTransactionErrorClassification = "retryable" | "terminal" | "unknown"

function hasRetryablePostgresCode(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== "object") return false
  if (
    ("code" in value && ["40001", "40P01", "55P03"].includes(String(value.code))) ||
    ("originalCode" in value && ["40001", "40P01", "55P03"].includes(String(value.originalCode)))
  ) {
    return true
  }
  return ["cause", "driverAdapterError", "meta"].some(
    (key) => key in value && hasRetryablePostgresCode(value[key as keyof typeof value], depth + 1),
  )
}

export function classifyPrismaTransactionError(
  error: unknown,
): PrismaTransactionErrorClassification {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2034"].includes(error.code)) return "retryable"
    if (error.code === "P2010" && hasRetryablePostgresCode(error.meta)) {
      return "retryable"
    }
    return "terminal"
  }
  if (hasRetryablePostgresCode(error)) return "retryable"
  return "unknown"
}
