import type { BuildRecord } from "../../contracts/types"

const labels: Record<BuildRecord["state"], string> = {
  failed: "Failed",
  queued: "Queued",
  running: "Running",
  successful: "Successful",
  superseded: "Superseded",
}

export function buildStateLabel(state: BuildRecord["state"]) {
  return labels[state]
}
