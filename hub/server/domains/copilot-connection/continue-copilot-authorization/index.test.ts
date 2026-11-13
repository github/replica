import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { Prisma } from "../../../generated/prisma/client"
import { continueCopilotAuthorization } from "."

describe("continueCopilotAuthorization()", () => {
  it("accepts runtime fields while forwarding only the authorization binding", async () => {
    const transaction = { $queryRaw: vi.fn().mockResolvedValue([{ id: randomUUID() }]) }
    const database: Parameters<typeof continueCopilotAuthorization>[0] = {
      $transaction: <Result>(operation: (value: Prisma.TransactionClient) => Promise<Result>) =>
        operation(transaction as unknown as Prisma.TransactionClient),
    }
    const mutate = vi.fn().mockResolvedValue({ disconnected: true })
    const authorizationId = randomUUID()
    const hubSessionId = randomUUID()

    await expect(
      continueCopilotAuthorization(
        database,
        {
          authorizationId,
          hubSessionId,
          operation: "DISCONNECT_COPILOT",
          sessionDigest: "a".repeat(64),
          signal: AbortSignal.abort(),
        },
        mutate,
      ),
    ).resolves.toEqual({ disconnected: true })

    expect(mutate).toHaveBeenCalledWith({
      authorizationId,
      hubSessionId,
      operation: "DISCONNECT_COPILOT",
    })
  })
})
