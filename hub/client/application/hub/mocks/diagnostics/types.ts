import type { MockProfile, MockScenario } from "../contracts/types"

export interface Diagnostic {
  id: number
  message: string
}

export interface Snapshot {
  profile: MockProfile
  scenario: MockScenario
  messages: Diagnostic[]
}
