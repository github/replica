import type { DeploymentConfig, RemovalTarget, RunCommand, WizardUI } from "../../installer/types.ts"

export type RemovalModule = "provision" | "app" | "foundation"
export interface RemovalResource {
  address: string
  id: string
  type: string
  values: Record<string, unknown>
}
export interface RemovalContext {
  target: RemovalTarget
  config: DeploymentConfig
  directory: string
  run: RunCommand
  ui: WizardUI
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  azure(...args: string[]): Promise<string>
}
