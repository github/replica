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
      /** Null for a repository Hub cannot serve to agents, such as a local one. */
      mcpUrl: string | null
      signedInAs: string
      connections: AgentConnection[]
      notice: string | null
    }
  | {
      view: "approval"
      requestingAgent: string
      /** Where the agent asked Hub to send its access, such as "127.0.0.1:33418". */
      destination: string
      /** Whether that address is on the person's own computer. */
      localDestination: boolean
      session: string
      signedInAs: string
      expiresLabel: string
      decisionPath: string
    }
