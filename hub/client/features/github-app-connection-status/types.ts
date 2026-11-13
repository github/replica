export type GithubSettingState = "present" | "missing" | "invalid"
export type GithubCheckResult = "pass" | "fail" | "unknown"

export interface GithubSettingStatus {
  key: string
  state: GithubSettingState
}

export interface GithubConnectionCheckResult {
  name: string
  result: GithubCheckResult
  detail: string
  settingsUrl?: string
}
