import { mockProfileSchema, mockScenarioSchema } from "../contracts"
import type { MockProfile, MockScenario } from "../contracts/types"

import type { Snapshot } from "./types"

const profileKey = "replica:mock-profile"
const scenarioKey = "replica:mock-scenario"
const messageLimit = 5
const listeners = new Set<() => void>()
let snapshot: Snapshot = { profile: "owner", scenario: "normal", messages: [] }
let nextId = 1

function update(values: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...values }
  listeners.forEach((listener) => listener())
}

function report(message: string) {
  update({ messages: [...snapshot.messages, { id: nextId++, message }].slice(-messageLimit) })
}

function remember(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
    report("The browser could not retain the selected test setting.")
  }
}

export const mockDiagnostics = {
  subscribe(this: void, listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => snapshot,
  initialize() {
    let profile: string | null = null
    let scenario: string | null = null
    try {
      profile = window.sessionStorage.getItem(profileKey)
      scenario =
        new URL(window.location.href).searchParams.get("mockScenario") ??
        window.sessionStorage.getItem(scenarioKey)
    } catch (error) {
      if (!(error instanceof DOMException)) throw error
      report("Browser storage is unavailable; test settings will last for this page only.")
    }
    const parsedProfile = mockProfileSchema.safeParse(profile ?? "owner")
    const parsedScenario = mockScenarioSchema.safeParse(scenario ?? "normal")
    if (!parsedProfile.success || !parsedScenario.success) {
      report("An unknown test setting was ignored. Choose a persona and API scenario below.")
    }
    update({
      profile: parsedProfile.success ? parsedProfile.data : "owner",
      scenario: parsedScenario.success ? parsedScenario.data : "normal",
    })
  },
  selectProfile(profile: MockProfile) {
    remember(profileKey, profile)
    update({ profile })
  },
  selectScenario(scenario: MockScenario) {
    remember(scenarioKey, scenario)
    update({ scenario })
  },
  report,
  clear(this: void) {
    update({ messages: [] })
  },
}
