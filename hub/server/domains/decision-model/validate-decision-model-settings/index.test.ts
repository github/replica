import { describe, expect, it } from "vitest"

import { validateDecisionModelSettings } from "."

function settings() {
  return {
    enabled: true,
    backend: "customer-gpu",
    maxUpdates: 1_000,
    maxSeconds: 3_600,
    monthlyBudgetCredits: "250.5",
  }
}

describe("validateDecisionModelSettings()", () => {
  it("accepts the documented resource and budget boundaries", () => {
    expect(
      validateDecisionModelSettings({
        ...settings(),
        maxUpdates: 1,
        maxSeconds: 1,
        monthlyBudgetCredits: "0",
      }),
    ).toMatchObject({ maxUpdates: 1, maxSeconds: 1, monthlyBudgetCredits: "0" })
    expect(
      validateDecisionModelSettings({
        ...settings(),
        maxUpdates: 100_000,
        maxSeconds: 86_400,
        monthlyBudgetCredits: "1000000",
      }),
    ).toMatchObject({
      maxUpdates: 100_000,
      maxSeconds: 86_400,
      monthlyBudgetCredits: "1000000",
    })
  })

  it.each([
    ["maxUpdates below its minimum", { maxUpdates: 0 }],
    ["maxUpdates above its maximum", { maxUpdates: 100_001 }],
    ["maxSeconds below its minimum", { maxSeconds: 0 }],
    ["maxSeconds above its maximum", { maxSeconds: 86_401 }],
  ])("rejects %s", (_, override) => {
    expect(() => validateDecisionModelSettings({ ...settings(), ...override })).toThrow()
  })

  it.each(["-1", "1e3", "1.0000000001", "1000000.000000001"])(
    "rejects the unbounded or non-canonical budget %s",
    (monthlyBudgetCredits) => {
      expect(() => validateDecisionModelSettings({ ...settings(), monthlyBudgetCredits })).toThrow()
    },
  )

  it("rejects settings that could smuggle provider credentials into durable configuration", () => {
    expect(() =>
      validateDecisionModelSettings({
        ...settings(),
        credential: "must-not-be-persisted",
      }),
    ).toThrow()
  })
})
