export interface AgentConnectionRouteDependencies {
  applicationOrigin: string
  databaseUrl: string
  learning: {
    cliPath: string
    learningDatabaseUrl?: string
    nodePath: string
    root: string
    staticDirectories: string[]
  }
}
