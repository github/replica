export interface AgentConnection {
  id: string
  name: string
  connectedAt: string
  lastUsedAt: string
}

interface AgentConnectionsPrototypeBase {
  repositoryId: string
  repositoryName: string
  hubUrl: string
  signedInAs: string
}

export type AgentConnectionsPrototypeData =
  | (AgentConnectionsPrototypeBase & {
      view: "connections"
      connections: AgentConnection[]
    })
  | (AgentConnectionsPrototypeBase & {
      view: "approval"
      connections: AgentConnection[]
      requestingAgent: string
    })
