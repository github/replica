import type { MockScenario } from "../../contracts"

export function mockScenarioHeaders(scenario: MockScenario): Headers {
  const headers = new Headers()
  if (import.meta.env.DEV && import.meta.env.MODE === "mock") {
    headers.set("X-Replica-Mock-Scenario", scenario)
  }
  return headers
}
