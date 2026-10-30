import { Button } from "@primer/react-brand"

import { mockScenarios } from "../contracts"
import type { MockScenario } from "../contracts"

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
}

export function ModeNotice({ scenario, onScenarioChange, onReset }: Props) {
  const knownScenario = mockScenarios.some((value) => value === scenario)
  return (
    <aside className="hub-mode-notice" aria-label="Mock frontend controls">
      <strong>Mock data</strong>
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
