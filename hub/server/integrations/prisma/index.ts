import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "../../generated/prisma/client.ts"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error("Set DATABASE_URL before importing the Prisma client.")
}

const globalForPrisma = globalThis as typeof globalThis & { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
