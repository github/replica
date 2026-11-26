export interface AgentConnectionRouteDependencies {
  applicationOrigin: string
  learning: {
    cliPath: string
    learningDatabaseUrl?: string
    nodePath: string
    root: string
    staticDirectories: string[]
  }
}
