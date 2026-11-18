import type {
  GithubConnectionCheckResult,
  GithubSettingStatus,
} from "@features/github-app-connection-status/types"
import type { GithubAppSetupUrls } from "@components/github-app-fields/types"

export interface GithubAppSetupStatusData {
  status: "not_configured" | "incomplete" | "configured"
  signInEnabled: boolean
  settings: GithubSettingStatus[]
  urls: GithubAppSetupUrls
  connectedRepositories: string[]
}

export interface GithubAppSetupShowPageProps {
  status: GithubAppSetupStatusData | null
  bootstrap: { error: string | null; pending: boolean; onSubmit: (secret: string) => void }
  organization: string
  onOrganizationChange: (organization: string) => void
  creationUrl: string
  connection: {
    checks: GithubConnectionCheckResult[] | null
    testing: boolean
    error: string | null
    onTest: () => void
  }
  signInPath: string
}
