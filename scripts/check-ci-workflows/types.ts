interface Step {
  name?: string
  uses?: string
  if?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, string | number | boolean>
}

interface Job {
  name?: string
  uses?: string
  needs?: string | string[]
  if?: string
  steps?: Step[]
  strategy?: {
    matrix: Record<string, (string | number)[]>
    "fail-fast"?: boolean
  }
}

export interface Workflow {
  jobs: Record<string, Job>
}
