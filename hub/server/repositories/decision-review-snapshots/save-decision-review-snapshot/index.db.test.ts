import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { saveDecisionReviewSnapshot } from "."

describe("saveDecisionReviewSnapshot()", () => {
  it("keeps the winning checkpoint when a stale writer tries to create or update it", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/checkout", defaultBranch: "main" },
    })
    const first = {
      digest: `sha256:${"a".repeat(64)}`,
      snapshotId: randomUUID(),
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
    }
    const changed = {
      digest: `sha256:${"b".repeat(64)}`,
      snapshotId: randomUUID(),
      capturedAt: new Date("2026-01-01T00:01:00.000Z"),
    }
    const winner = {
      ...first,
      snapshotId: randomUUID(),
      capturedAt: new Date("2026-01-01T00:02:00.000Z"),
    }

    const client = new pg.Client({ connectionString: getDatabaseUrl() })
    await client.connect()
    try {
      expect(await saveDecisionReviewSnapshot(client, repository.id, first, null)).toBe(true)
      expect(await saveDecisionReviewSnapshot(client, repository.id, changed, first)).toBe(true)
      expect(await saveDecisionReviewSnapshot(client, repository.id, winner, changed)).toBe(true)

      expect(await saveDecisionReviewSnapshot(client, repository.id, changed, null)).toBe(false)
      expect(await saveDecisionReviewSnapshot(client, repository.id, changed, first)).toBe(false)
      await expect(
        prisma.decisionReviewSnapshot.findUniqueOrThrow({ where: { repositoryId: repository.id } }),
      ).resolves.toMatchObject(winner)
    } finally {
      await client.end()
    }
  })
})
