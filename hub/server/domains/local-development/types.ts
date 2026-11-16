import type { runCommand } from "../../integrations/process/run-command/index.ts"

export type LocalDevelopmentConfiguration =
  | { enabled: false }
  | {
      buildActionDirectory: string
      createPrototypeScript: string
      enabled: true
      root: string
      sourceRoot: string
    }

export type PrepareLocalDevelopmentDependencies = {
  runCommand?: typeof runCommand
}

export type PrepareLocalDevelopmentResult = {
  root: string
  seeded: boolean
}
