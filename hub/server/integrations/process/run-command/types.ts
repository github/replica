export type RunCommandOptions = {
  arguments: string[]
  command: string
  cwd: string
  environment?: NodeJS.ProcessEnv
}
