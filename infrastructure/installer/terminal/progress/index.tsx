import { Text } from "ink"

import { wizardPhases, type PreviewProgress, type WizardPhase } from "../../types.ts"
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
  preview,
  configureOnly = false,
  complete = false,
  compact = false,
  blocked = false,
}: {
  phase: WizardPhase
  preview?: PreviewProgress
  configureOnly?: boolean
  complete?: boolean
  compact?: boolean
  blocked?: boolean
}) {
  if (preview === "skipped") return <Text>Private preview preparation skipped</Text>
  if (preview === "staged") return <Text>Disabled reader staged</Text>
  const phases: readonly WizardPhase[] = preview
    ? ["review", "provision", "verify"]
    : configureOnly ? wizardPhases.slice(0, 4) : wizardPhases
  const activePhase = preview ?? phase
  const current = phases.indexOf(activePhase)
  if (compact)
    return (
      <Text>
        {complete ? "Complete" : `${blocked ? "Waiting: " : ""}${labels[activePhase]}`} ({current + 1}/
        {phases.length})
      </Text>
    )
  return (
    <Text>
      {phases.map((step, index) => {
        const done = complete || index < current
        const active = !complete && step === activePhase
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
