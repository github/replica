export interface AgentConnection {
  id: string
  name: string
  connectedLabel: string
  lastUsedLabel: string
  revokePath: string
}

export type AgentConnectionsPageData =
  | {
      view: "connections"
      repositoryName: string
      mcpUrl: string
      signedInAs: string
      connections: AgentConnection[]
      notice: string | null
    }
  | {
      view: "approval"
      requestingAgent: string
      signedInAs: string
      expiresLabel: string
      decisionPath: string
    }
