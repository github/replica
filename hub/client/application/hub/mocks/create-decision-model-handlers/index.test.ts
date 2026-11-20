import { setupServer } from "msw/node"
import { describe, expect, it, onTestFinished } from "vitest"

import { decisionModelOverviewResponseSchema } from "@application/hub/decision-model-contracts"

import { createDecisionModelHandlers } from "."
import { createMockStore } from "../create-mock-store"

function setup() {
  const store = createMockStore({ origin: window.location.origin })
  store.session.select("admin")
  const server = setupServer(...createDecisionModelHandlers(store.flowContext))
  server.listen({ onUnhandledRequest: "error" })
  onTestFinished(() => server.close())
  return store
}

describe("createDecisionModelHandlers()", () => {
  it("isolates mutable decision-model state by repository", async () => {
    const store = setup()

    const save = await fetch(`${store.origin}/api/repositories/2001/decision-model`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        backend: "fixture",
        maxUpdates: 4,
        maxSeconds: 120,
        monthlyBudgetCredits: "5",
      }),
    })
    expect(save.status).toBe(200)

    const [populated, empty] = await Promise.all([
      fetch(`${store.origin}/api/repositories/2001/decision-model`).then(async (response) =>
        decisionModelOverviewResponseSchema.parse(await response.json()),
      ),
      fetch(`${store.origin}/api/repositories/2002/decision-model`).then(async (response) =>
        decisionModelOverviewResponseSchema.parse(await response.json()),
      ),
    ])
    expect(populated.configuration).toMatchObject({ enabled: false, generation: 2 })
    expect(empty.configuration).toBeNull()
    expect(empty.candidates).toEqual([])
  })

  it("links evaluation findings to an existing successful mock Build", async () => {
    const store = setup()
    const response = await fetch(`${store.origin}/api/repositories/2001/decision-model`)
    const overview = decisionModelOverviewResponseSchema.parse(await response.json())
    const evaluation = overview.evaluations[0]
    if (!evaluation) throw new Error("The populated mock must include a Build evaluation.")

    expect(
      store.getPrototype("2001", evaluation.build.prototypeId, evaluation.build.number),
    ).toMatchObject({
      selectedBuild: { state: "successful" },
    })
  })

  it("does not restore a previous candidate after it is rejected", async () => {
    const store = setup()
    const overview = await fetch(`${store.origin}/api/repositories/2001/decision-model`).then(
      async (response) => decisionModelOverviewResponseSchema.parse(await response.json()),
    )
    const candidate = overview.candidates.find(
      (entry: { runtimeCandidateId: string }) => entry.runtimeCandidateId === "fixture-candidate-2",
    )
    const previous = overview.candidates.find(
      (entry: { runtimeCandidateId: string }) => entry.runtimeCandidateId === "fixture-candidate-1",
    )
    if (!candidate || !previous) throw new Error("The populated mock must include two candidates.")

    const promotion = await fetch(
      `${store.origin}/api/repositories/2001/decision-model/candidates/${candidate.id}/promotion`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedGeneration: 1 }),
      },
    )
    expect(promotion.status).toBe(200)

    const rejection = await fetch(
      `${store.origin}/api/repositories/2001/decision-model/candidates/${previous.id}/rejection`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Do not restore this candidate." }),
      },
    )
    expect(rejection.status).toBe(200)

    const refreshed = await fetch(`${store.origin}/api/repositories/2001/decision-model`).then(
      async (response) => decisionModelOverviewResponseSchema.parse(await response.json()),
    )
    expect(refreshed.promotion?.rollbackAvailable).toBe(false)

    const rollback = await fetch(`${store.origin}/api/repositories/2001/decision-model/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedGeneration: 2 }),
    })
    expect(rollback.status).toBe(409)
  })
})
