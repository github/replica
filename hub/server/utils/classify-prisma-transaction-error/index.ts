import { Prisma } from "../../generated/prisma/client.ts"

export type PrismaTransactionErrorClassification = "retryable" | "terminal" | "unknown"

function hasSerializationCode(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== "object") return false
  if (
    ("code" in value && value.code === "40001") ||
    ("originalCode" in value && value.originalCode === "40001")
  ) {
    return true
  }
  return ["cause", "driverAdapterError", "meta"].some(
    (key) => key in value && hasSerializationCode(value[key as keyof typeof value], depth + 1),
  )
}

export function classifyPrismaTransactionError(
  error: unknown,
): PrismaTransactionErrorClassification {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2002", "P2034"].includes(error.code)) return "retryable"
    if (error.code === "P2010" && hasSerializationCode(error.meta)) {
      return "retryable"
    }
    return "terminal"
  }
  if (hasSerializationCode(error)) return "retryable"
  return "unknown"
}
