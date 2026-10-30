import { Button } from "@primer/react-brand"

import { mockScenarios } from "../contracts"
import type { MockScenario } from "../contracts"
import { mockProfiles } from "../session-contracts"
import type { MockProfile } from "../session-contracts"

import "./styles.css"

const labels: Record<MockScenario, string> = {
  normal: "Normal",
  loading: "Slow response",
  empty: "Empty",
  forbidden: "Forbidden",
  "server-error": "Server error",
  "invalid-response": "Invalid response",
  "save-error": "Save error",
}

interface Props {
  scenario: string
  onScenarioChange: (scenario: string) => void
  onReset: () => void
  profile?: MockProfile
  changingProfile?: boolean
  sessionUnavailable?: boolean
  onProfileChange?: (profile: MockProfile) => void
  destinations?: Array<{ path: string; label: string }>
  onNavigate?: (path: string) => void
}

const profileLabels: Record<MockProfile, string> = {
  owner: "Owner - Octocat",
  reader: "Read-only - Mona",
  admin: "Administrator - Octocat",
  "signed-out": "Signed out",
}

export function ModeNotice({
  scenario,
  onScenarioChange,
  onReset,
  profile = "owner",
  changingProfile = false,
  sessionUnavailable = false,
  onProfileChange,
  destinations = [],
  onNavigate,
}: Props) {
  const knownScenario = mockScenarios.some((value) => value === scenario)
  return (
    <aside className="hub-mode-notice" aria-label="Mock frontend controls">
      <strong>Mock data</strong>
      {onProfileChange ? (
        <label>
          <span className="hub-mode-notice__label">Mock user</span>
          <select
            value={sessionUnavailable ? "unavailable" : profile}
            disabled={changingProfile}
            onChange={(event) => {
              const next = mockProfiles.find((value) => value === event.currentTarget.value)
              if (next) onProfileChange(next)
            }}
          >
            {sessionUnavailable ? (
              <option value="unavailable" disabled>
                Session unavailable
              </option>
            ) : null}
            {mockProfiles.map((value) => (
              <option key={value} value={value}>
                {profileLabels[value]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {onNavigate ? (
        <label>
          <span className="hub-mode-notice__label">Mock flow</span>
          <select
            value=""
            onChange={(event) => {
              if (event.currentTarget.value) onNavigate(event.currentTarget.value)
            }}
          >
            <option value="" disabled>
              Explore a flow
            </option>
            {destinations.map(({ path, label }) => (
              <option key={path} value={path}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        <span className="hub-mode-notice__label">Mock API scenario</span>
        <select value={scenario} onChange={(event) => onScenarioChange(event.currentTarget.value)}>
          {!knownScenario ? (
            <option value={scenario} disabled>
              Invalid scenario
            </option>
          ) : null}
          {mockScenarios.map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        size="small"
        variant="subtle"
        aria-label="Reset mock data"
        onClick={onReset}
      >
        Reset
      </Button>
    </aside>
  )
}
