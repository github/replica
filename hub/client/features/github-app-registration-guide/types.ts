export type GithubAppRegistrationPath = "prefilled" | "manual" | "reuse"

export interface GithubAppSetupUrls {
  homepage: string
  callback: string
  setup: string
  webhook: string
}
