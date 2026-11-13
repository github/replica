import type { DeploymentConfig, InstallerUI, RunCommand } from "../../installer/types.ts"

export interface DeploymentApproval {
  sourceRevision: string
  sourceStatus: string
  sourceFingerprint: string
}

export interface AzureInstallation {
  config: DeploymentConfig
  directory: string
  run: RunCommand
  ui: InstallerUI
  env: NodeJS.ProcessEnv
  approval?: DeploymentApproval
  signal?: AbortSignal
  azure(...args: string[]): Promise<string>
  saveNpmRegistry?(registry: string): Promise<void>
}

export interface Foundation {
  vault_id: string
  vault_url: string
  registry_id: string
  registry_url: string
}

export interface Installation {
  environment_id: string
  resource_group: string
  resource_group_id: string
  app_id: string | null
  storage_account: string
  storage_account_id: string
  postgres_server_id: string
  postgres_host: string
  url: string | null
}

export interface RecoveryInspection {
  blockers: string[]
  databaseReview: boolean
  evidence: string
  hub?: { name: string; id: string }
}

export interface DeploymentResult {
  name: string
  url: string
  subscriptionId: string
  tenantId: string
  location: string
  image: string
  resources: {
    resourceGroup: string
    app: string
    environment: string
    database: string
    storage: string
    registry: string
    vault: string
    stateStorage: string
  }
}
