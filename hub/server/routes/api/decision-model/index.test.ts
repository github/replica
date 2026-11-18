import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app/index.ts"
import type { DecisionModelRouteDependencies } from "./types.ts"

const repositoryId = "11111111-2222-4333-8444-555555555555"
const membershipId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function dependencies(role: "MEMBER" | "ADMINISTRATOR"): DecisionModelRouteDependencies {
  return {
    applicationOrigin: "http://127.0.0.1:5173",
    currentSession: {
      restore: vi.fn().mockResolvedValue({
        membershipId,
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        provider: "github",
        login: "mona",
        name: "Mona",
        role,
      }),
    },
    getOverview: vi.fn().mockResolvedValue({ configuration: null }),
    saveSettings: vi.fn().mockResolvedValue({ generation: 1 }),
    requestTraining: vi.fn().mockResolvedValue({ jobId: "job" }),
    getTrainingJob: vi.fn(),
    cancelTraining: vi.fn(),
    promote: vi.fn(),
    rollback: vi.fn(),
    evaluateBuild: vi.fn(),
  }
}

async function withApp(
  decisionModels: DecisionModelRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(createApp({ decisionModels }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe("decision-model routes", () => {
  it("does not expose control-plane state to a Hub member", async () => {
    const getOverview = vi.fn()
    const deps = { ...dependencies("MEMBER"), getOverview }

    await withApp(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/decision-model`, {
        headers: { cookie: "hub_session=current-session" },
      })

      expect(response.status).toBe(403)
      expect(getOverview).not.toHaveBeenCalled()
    })
  })

  it("passes bounded repository settings to the administrator contract", async () => {
    const saveSettings = vi.fn().mockResolvedValue({ generation: 1 })
    const deps = { ...dependencies("ADMINISTRATOR"), saveSettings }

    await withApp(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/repositories/${repositoryId}/decision-model`, {
        method: "PATCH",
        headers: {
          cookie: "hub_session=current-session",
          "content-type": "application/json",
          origin: "http://127.0.0.1:5173",
        },
        body: JSON.stringify({
          enabled: true,
          backend: "fixture",
          maxUpdates: 8,
          maxSeconds: 300,
          monthlyBudgetCredits: "10",
        }),
      })

      expect(response.status).toBe(200)
      expect(saveSettings).toHaveBeenCalledWith({
        repositoryId,
        actorMembershipId: membershipId,
        settings: {
          enabled: true,
          backend: "fixture",
          maxUpdates: 8,
          maxSeconds: 300,
          monthlyBudgetCredits: "10",
        },
      })
    })
  })
})
