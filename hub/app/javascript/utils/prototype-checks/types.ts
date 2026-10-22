export type CheckFinding = {
  id: string
  severity: "error" | "warning" | "info"
  criterionId?: string
  title: string
  description: string
  evidence: string
  file?: string
  line?: number
}

export type CheckReadCoverage = {
  version: 1
  files: {
    file: string
    totalBytes: number
    readBytes: number
    required: boolean
    status: "read" | "partial" | "unread" | "blocked"
    reason?: "missing" | "binary" | "invalid_utf8" | "partial_read" | "not_read"
  }[]
}

export type CheckState = {
  id: string
  name: string
  runner: "command" | "agent"
  automatic: boolean
  runId?: string
  fingerprint?: string
  status:
    "not_run" | "queued" | "running" | "completed" | "execution_error" | "cancelled" | "out_of_date"
  outcome: "pass" | "fail" | "unverified" | null
  summary: string | null
  limitations?: string[]
  coverageReason?: "not_recorded" | "incomplete" | "no_source" | null
  scope?: { files: string[]; contextFiles: string[] } | null
  trigger?: "manual" | "automatic"
  requestedAt?: string
  startedAt?: string
  finishedAt?: string
  error: string | null
  criteria: {
    id: string
    name?: string
    status: "pass" | "fail" | "unverified"
    evidence: string
    coverageReason?: "not_recorded" | "incomplete" | "no_source"
  }[]
  findings: CheckFinding[]
  readCoverage?: CheckReadCoverage | null
}

export type ChecksState = {
  state: "loading" | "error" | "unconfigured" | "ready"
  error?: string | null
  branch?: string
  checks: CheckState[]
}

export type ChecksAction =
  | { action: "run" | "cancel"; checkIds?: string[] }
  | { action: "fix"; checkId: string; runId: string; findingIds: string[] }
  | { action: "reset" }
