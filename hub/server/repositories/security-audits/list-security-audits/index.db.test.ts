import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { listSecurityAudits } from "."

async function createAudit(input: { createdAt: Date; id: string }) {
  await prisma.securityAudit.create({
    data: {
      ...input,
      action: "session.created",
      context: {},
      outcome: "SUCCESS",
      targetType: "hub_session",
    },
  })
}

describe("listSecurityAudits()", () => {
  it("defaults to 50 records and returns a cursor only when another record exists", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      action: "session.created",
      context: {},
      createdAt: new Date(Date.UTC(2026, 10, 10, 0, index)),
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      outcome: "SUCCESS" as const,
      targetType: "hub_session",
    }))
    await prisma.securityAudit.createMany({ data: records })

    const result = await listSecurityAudits(prisma)

    expect(result.records).toHaveLength(50)
    expect(result.records[0]?.id).toBe(records[50]?.id)
    expect(result.records.at(-1)?.id).toBe(records[1]?.id)
    expect(result.nextCursor).toEqual({
      createdAt: records[1]?.createdAt,
      id: records[1]?.id,
    })
    await expect(prisma.securityAudit.count()).resolves.toBe(51)
  })

  it("uses descending IDs to paginate records with the same timestamp", async () => {
    const createdAt = new Date("2026-11-10T12:00:00.000Z")
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]
    await Promise.all(ids.map((id) => createAudit({ createdAt, id })))

    const firstPage = await listSecurityAudits(prisma, { limit: 2 })

    expect(firstPage.records.map((record) => record.id)).toEqual([ids[2], ids[1]])
    expect(firstPage.nextCursor).toEqual({ createdAt, id: ids[1] })

    const secondPage = await listSecurityAudits(prisma, {
      before: firstPage.nextCursor!,
      limit: 2,
    })

    expect(secondPage.records.map((record) => record.id)).toEqual([ids[0]])
    expect(secondPage.nextCursor).toBeNull()
  })

  it("continues from the first page boundary when a newer record is inserted", async () => {
    const ids = {
      oldest: "00000000-0000-4000-8000-000000000011",
      middle: "00000000-0000-4000-8000-000000000012",
      newest: "00000000-0000-4000-8000-000000000013",
      inserted: "00000000-0000-4000-8000-000000000014",
    }
    await createAudit({ createdAt: new Date("2026-11-10T09:00:00.000Z"), id: ids.oldest })
    await createAudit({ createdAt: new Date("2026-11-10T10:00:00.000Z"), id: ids.middle })
    await createAudit({ createdAt: new Date("2026-11-10T11:00:00.000Z"), id: ids.newest })

    const firstPage = await listSecurityAudits(prisma, { limit: 2 })
    await createAudit({ createdAt: new Date("2026-11-10T13:00:00.000Z"), id: ids.inserted })

    const secondPage = await listSecurityAudits(prisma, {
      before: firstPage.nextCursor!,
      limit: 2,
    })

    expect(firstPage.records.map((record) => record.id)).toEqual([ids.newest, ids.middle])
    expect(secondPage.records.map((record) => record.id)).toEqual([ids.oldest])
    expect(secondPage.nextCursor).toBeNull()
  })
})
