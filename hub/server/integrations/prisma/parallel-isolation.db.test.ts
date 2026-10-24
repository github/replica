import { describe, expect, inject, it } from "vitest"

import { prisma } from "./index"

describe("Prisma parallel database isolation", () => {
  it.each(["first case", "second case"])(
    "starts the %s empty without sharing another file's records",
    async () => {
      try {
        const database = inject("testDatabase")
        const [connection] = await prisma.$queryRaw<{ name: string }[]>`
          SELECT current_database() AS name
        `
        expect(connection?.name).toBe(`${database.prefix}_${process.env.VITEST_POOL_ID}`)

        await prisma.$executeRaw`
          CREATE TABLE IF NOT EXISTS public.test_worker_isolation (
            id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            unique_key text NOT NULL UNIQUE
          )
        `
        const [before] = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) FROM public.test_worker_isolation
        `
        expect(before?.count).toBe(0n)

        await prisma.$executeRaw`
          INSERT INTO public.test_worker_isolation (unique_key) VALUES ('shared-key')
        `

        const records = await prisma.$queryRaw<{ id: number; unique_key: string }[]>`
          SELECT id, unique_key FROM public.test_worker_isolation
        `
        expect(records).toEqual([{ id: 1, unique_key: "shared-key" }])
      } finally {
        await prisma.$disconnect()
      }
    },
  )
})
