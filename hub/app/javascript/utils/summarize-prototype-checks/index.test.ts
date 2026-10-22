import { describe, expect, it } from "vitest"

import type { ChecksState, CheckState } from "@utils/prototype-checks/types"

import { summarizePrototypeChecks } from "."

function state(checks: Partial<CheckState>[]): ChecksState {
  return {
    state: "ready",
    checks: checks.map((check, index) => ({
      id: `check-${index}`,
      name: `Check ${index}`,
      runner: "command",
      automatic: true,
      outcome: "pass",
      summary: "Verified",
      error: null,
      criteria: [{ id: "result", status: "pass", evidence: "Verified" }],
      findings: [],
      status: "completed",
      ...check,
    })),
  }
}

describe("summarizePrototypeChecks()", () => {
  it("counts every current passing check equally, including manual checks", () => {
    const result = summarizePrototypeChecks(
      state([
        { automatic: false },
        {},
        {},
        { status: "out_of_date", outcome: "pass" },
        { status: "not_run" },
      ]),
    )
    expect(result.label).toBe("3/5")
    expect(result.status).toBe("neutral")
    expect(result.description).toContain("1 not run")
    expect(result.description).toContain("1 out of date")
  })

  it.each(["queued", "running"] as const)(
    "shows activity ahead of existing failures for a %s check",
    (status) => {
      const result = summarizePrototypeChecks(
        state([
          {},
          { status },
          {
            outcome: "fail",
          },
        ]),
      )
      expect(result.label).toBe("1/3")
      expect(result.status).toBe("running")
      expect(result.description).toContain("1 failed")
      expect(result.description).toContain(`1 ${status}`)
    },
  )

  it("uses a failed outcome rather than a warning even when no criteria are configured", () => {
    const result = summarizePrototypeChecks(
      state([
        {},
        {
          outcome: "fail",
          criteria: [],
        },
        { status: "execution_error" },
      ]),
    )
    expect(result.label).toBe("1/3")
    expect(result.status).toBe("failed")
    expect(result.description).toContain("1 could not finish")
  })

  it.each([
    { status: "execution_error" as const },
    { outcome: null },
    {
      outcome: "unverified" as const,
      criteria: [],
    },
  ])("warns without claiming a quality failure for %j", (check) => {
    const result = summarizePrototypeChecks(state([{}, check]))
    expect(result.label).toBe("1/2")
    expect(result.status).toBe("warning")
  })

  it("shows success only when every configured check has a current passing outcome", () => {
    expect(summarizePrototypeChecks(state([{}, {}]))).toMatchObject({
      label: "2/2",
      status: "passed",
    })
    expect(summarizePrototypeChecks(state([{}, { status: "cancelled" }]))).toMatchObject({
      label: "1/2",
      status: "neutral",
    })
  })

  it("does not present cached passes as current when fetching status fails", () => {
    const previous = state([{}])
    expect(summarizePrototypeChecks(previous, "Connection failed")).toMatchObject({
      label: "0/1",
      status: "warning",
    })
    expect(summarizePrototypeChecks({ ...previous, state: "error" })).toMatchObject({
      label: "0/1",
      status: "warning",
    })
  })

  it("uses the report outcome rather than inferring a pass from criteria or the absence of findings", () => {
    expect(
      summarizePrototypeChecks(
        state([
          { outcome: "pass", criteria: [] },
          {
            outcome: "unverified",
            criteria: [{ id: "result", status: "pass", evidence: "Read source" }],
          },
        ]),
      ),
    ).toMatchObject({ label: "1/2", status: "warning" })
  })

  it("avoids a zero denominator and distinguishes initial loading from unconfigured checks", () => {
    expect(summarizePrototypeChecks(null)).toMatchObject({
      label: "Checks",
      status: "running",
    })
    const unconfigured = summarizePrototypeChecks({ ...state([]), state: "unconfigured" })
    expect(unconfigured).toMatchObject({
      label: "Checks",
      status: "neutral",
    })
    expect(unconfigured.description).toContain("No checks configured")
  })
})
