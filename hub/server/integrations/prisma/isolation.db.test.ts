import { describe, expect, inject, it } from "vitest"

import { resetDatabase } from "../../../test/database/reset-database"

import { prisma } from "./index"

describe("Prisma database isolation", () => {
  it.each(["first case", "second case"])(
    "starts the %s empty in its assigned worker database",
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

  it("resets custom-schema tables, foreign keys and identities without deleting migrations", async () => {
    try {
      await prisma.$executeRaw`CREATE SCHEMA IF NOT EXISTS test_isolation`
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS public.test_reset_parents (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY
        )
      `
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS test_isolation.children (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          parent_id integer NOT NULL REFERENCES public.test_reset_parents(id)
        )
      `
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS public._prisma_migrations (
          id varchar(36) PRIMARY KEY,
          checksum varchar(64) NOT NULL,
          finished_at timestamptz,
          migration_name varchar(255) NOT NULL,
          logs text,
          rolled_back_at timestamptz,
          started_at timestamptz NOT NULL DEFAULT now(),
          applied_steps_count integer NOT NULL DEFAULT 0
        )
      `
      await prisma.$executeRaw`
        INSERT INTO public._prisma_migrations (id, checksum, migration_name)
        VALUES ('test-reset-migration', 'test-checksum', 'test-only-reset-marker')
      `
      const [parent] = await prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO public.test_reset_parents DEFAULT VALUES RETURNING id
      `
      await prisma.$executeRaw`
        INSERT INTO test_isolation.children (parent_id) VALUES (${parent!.id})
      `

      await resetDatabase(process.env.DATABASE_URL!)

      const [counts] = await prisma.$queryRaw<{ parents: bigint; children: bigint }[]>`
        SELECT
          (SELECT count(*) FROM public.test_reset_parents) AS parents,
          (SELECT count(*) FROM test_isolation.children) AS children
      `
      expect(counts).toEqual({ parents: 0n, children: 0n })
      const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM public._prisma_migrations WHERE id = 'test-reset-migration'
      `
      expect(migrations).toEqual([{ migration_name: "test-only-reset-marker" }])

      const parents = await prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO public.test_reset_parents DEFAULT VALUES RETURNING id
      `
      const children = await prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO test_isolation.children (parent_id) VALUES (${parents[0]!.id}) RETURNING id
      `
      expect(parents).toEqual([{ id: 1 }])
      expect(children).toEqual([{ id: 1 }])
    } finally {
      try {
        await prisma.$executeRaw`
          DELETE FROM public._prisma_migrations WHERE id = 'test-reset-migration'
        `
      } finally {
        await prisma.$disconnect()
      }
    }
  })
})
