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
  environment?: string
  permissions?: Record<string, string>
  concurrency?: {
    group?: string
    "cancel-in-progress"?: boolean
  }
  steps?: Step[]
  strategy?: {
    matrix: Record<string, (string | number)[]>
    "fail-fast"?: boolean
  }
}

export interface Workflow {
  on?: {
    pull_request?: null | Record<string, unknown>
    push?: Record<string, unknown>
    workflow_dispatch?: null | Record<string, unknown>
  }
  permissions?: Record<string, string>
  concurrency?: {
    group?: string
    "cancel-in-progress"?: boolean
  }
  jobs: Record<string, Job>
}
