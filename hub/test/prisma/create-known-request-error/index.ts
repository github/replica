import { Prisma } from "../../../server/generated/prisma/client.ts"

export function createKnownRequestError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("database failure", {
    clientVersion: "test",
    code,
    meta,
  })
}
