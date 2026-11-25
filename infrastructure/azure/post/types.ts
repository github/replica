import type { DeploymentConfig } from "../../installer/types.ts"

export interface PostSetupTarget {
  path: string
  config: DeploymentConfig
}

export interface PostDeployment {
  appId: string
  appName: string
  environmentId: string
  revision: string
  active: boolean
  image: string
  origin: string
  customHosts: string[]
  principalId: string
  environment: Record<string, string>
}

export interface PostInputs extends Record<string, unknown> {
  image: string
  deploy_hub: boolean
  runtime_environment_variables?: Record<string, string>
  runtime_secret_references?: Record<string, { key_vault_id: string; secret_id: string }>
  learning_database_secret?: { key_vault_id: string; secret_id: string }
  hub_application_origin?: string
  github_app_id?: string
  github_client_id?: string
  github_app_installation_id?: string
  github_provider_revision?: number
}
