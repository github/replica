import type { DeploymentConfig, InstallerUI, RunCommand } from "../../installer/types.ts"

export interface AzureInstallation {
  config: DeploymentConfig
  directory: string
  run: RunCommand
  ui: InstallerUI
  env: NodeJS.ProcessEnv
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
  storage_account: string
  postgres_host: string
  url: string | null
}
