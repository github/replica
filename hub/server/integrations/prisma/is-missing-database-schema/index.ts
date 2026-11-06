import { Prisma } from "../../../generated/prisma/client.ts"

function hasMissingRelationCode(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || typeof value !== "object") return false
  if (
    ("code" in value && value.code === "42P01") ||
    ("originalCode" in value && value.originalCode === "42P01")
  ) {
    return true
  }
  return ["cause", "driverAdapterError", "meta"].some(
    (key) => key in value && hasMissingRelationCode(value[key as keyof typeof value], depth + 1),
  )
}

export function isMissingDatabaseSchema(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some((nested) => isMissingDatabaseSchema(nested))
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || (error.code === "P2010" && hasMissingRelationCode(error.meta))
  }
  return hasMissingRelationCode(error)
}
