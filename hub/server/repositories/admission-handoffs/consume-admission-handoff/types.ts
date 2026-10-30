import type { Prisma } from "../../../generated/prisma/client.ts"

export type ConsumeAdmissionHandoffDatabase = Pick<Prisma.TransactionClient, "$queryRaw">

export type ConsumeAdmissionHandoffResult = "browser_mismatch" | "consumed" | "expired" | "replayed"
