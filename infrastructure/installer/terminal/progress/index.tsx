import { Text } from "ink"

import { wizardPhases, type WizardPhase } from "../../types.ts"
import { terminalColors } from "../theme/index.ts"

const labels: Record<WizardPhase, string> = {
  cloud: "Cloud",
  checks: "Checks",
  configure: "Configure",
  review: "Review",
  provision: "Provision",
  release: "Release",
  verify: "Verify",
}

export function Progress({
  phase,
  configureOnly = false,
  complete = false,
  compact = false,
  blocked = false,
}: {
  phase: WizardPhase
  configureOnly?: boolean
  complete?: boolean
  compact?: boolean
  blocked?: boolean
}) {
  const phases = configureOnly ? wizardPhases.slice(0, 4) : wizardPhases
  const current = phases.indexOf(phase)
  if (compact)
    return (
      <Text>
        {complete ? "Complete" : `${blocked ? "Waiting: " : ""}${labels[phase]}`} ({current + 1}/
        {phases.length})
      </Text>
    )
  return (
    <Text>
      {phases.map((step, index) => {
        const done = complete || index < current
        const active = !complete && step === phase
        return (
          <Text
            key={step}
            bold={active}
            dimColor={!active}
            color={active && blocked ? terminalColors.warning : undefined}
          >
            {index ? " -" : "-"}
            {done ? "+" : active ? (blocked ? "!" : ">") : "o"} {labels[step]}
          </Text>
        )
      })}
    </Text>
  )
}
