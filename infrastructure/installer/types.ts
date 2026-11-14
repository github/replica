export interface DeploymentConfig {
  version: 1
  cloud: "azure"
  name: string
  owner: string
  npmRegistry?: string
  azure: {
    subscriptionId: string
    tenantId: string
    location: string
    resourceGroup: string
  }
}

export interface RemovalTarget {
  path: string
  config: DeploymentConfig
}

export interface CommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
  // Public step description only; never use arguments, output, or credentials.
  label?: string
}

export type RunCommand = (
  executable: string,
  args: string[],
  options?: CommandOptions,
) => Promise<string>

export const wizardPhases = [
  "cloud",
  "checks",
  "configure",
  "review",
  "provision",
  "release",
  "verify",
] as const
export type WizardPhase = (typeof wizardPhases)[number]
export type NoticeLevel = "info" | "success" | "warning" | "error"

export interface FieldDefinition {
  id: string
  label: string
  help: string
  parse(value: unknown): string
  editingError?(value: string): string | undefined
  clearRejected?: boolean
}

export interface InstallerUI {
  removal?(active: boolean): void
  status(message: string): void
  notice?(level: NoticeLevel, message: string): void
  phase?(phase: WizardPhase): void | Promise<void>
  confirm(message: string): Promise<boolean>
  wait(message: string): Promise<void>
  select?(message: string, options: { label: string; value: string }[]): Promise<string>
  field?(definition: FieldDefinition, initialValue?: string): Promise<string>
  text?(message: string, initialValue?: string): Promise<string>
}

export interface WizardUI extends InstallerUI {
  welcome?(show: boolean): void
  complete?(): void
  cloud(): Promise<"azure">
  field?(definition: FieldDefinition, initialValue?: string): Promise<string>
  text(message: string, initialValue?: string): Promise<string>
  select(message: string, options: { label: string; value: string }[]): Promise<string>
}
