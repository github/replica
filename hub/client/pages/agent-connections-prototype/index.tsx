import { useRef, useState } from "react"
import { Button, Heading, Text } from "@primer/react-brand"

import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { CopyableCodeBlock } from "@components/copyable-code-block"
import { HubToast } from "@components/hub-toast"

import type { AgentConnectionsPrototypeData } from "./types"
import "./styles.css"

export function AgentConnectionsPrototype({ data }: { data: AgentConnectionsPrototypeData }) {
  const [connections, setConnections] = useState(data.connections)
  const [connectionToRevoke, setConnectionToRevoke] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [approval, setApproval] = useState<"pending" | "approved" | "cancelled">("pending")
  const connectionsHeadingRef = useRef<HTMLHeadingElement>(null)
  const endpoint = `${data.hubUrl.replace(/\/$/, "")}/mcp/repositories/${data.repositoryId}`
  const configuration = JSON.stringify({ mcpServers: { replica: { url: endpoint } } }, null, 2)
  const selectedConnection = connections.find(({ id }) => id === connectionToRevoke)

  function revokeConnection() {
    if (!selectedConnection) return
    setConnections((current) => current.filter(({ id }) => id !== selectedConnection.id))
    setConnectionToRevoke(null)
    setNotice(`${selectedConnection.name} can no longer access Hub.`)
  }

  if (data.view === "approval") {
    return (
      <main className="agent-connections">
        {approval === "pending" ? (
          <section aria-labelledby="agent-approval-title" className="agent-connections__approval">
            <Heading as="h1" id="agent-approval-title" size="5">
              Connect {data.requestingAgent} to Hub?
            </Heading>
            <Text as="p">
              You are signed in as <strong>{data.signedInAs}</strong>. This agent can read guidance
              and report which learnings it applied for repositories you can access. Hub checks
              access on every request; only people can accept or change learnings.
            </Text>
            <Text as="p">
              This does not allow session-message storage, screenshot storage, or automated
              screenshot review. Those choices require separate consent.
            </Text>
            <div className="agent-connections__actions">
              <Button onClick={() => setApproval("cancelled")} type="button" variant="subtle">
                Cancel
              </Button>
              <Button onClick={() => setApproval("approved")} type="button" variant="primary">
                Approve access
              </Button>
            </div>
          </section>
        ) : (
          <section aria-live="polite" className="agent-connections__approval-result">
            <Heading as="h1" size="5">
              {approval === "approved" ? "Agent connected" : "Connection cancelled"}
            </Heading>
            <Text as="p">
              {approval === "approved"
                ? `Return to ${data.requestingAgent} to continue. You can revoke its Hub access at any time.`
                : `You can close this page and return to ${data.requestingAgent}. No Hub access was granted.`}
            </Text>
          </section>
        )}
      </main>
    )
  }

  return (
    <div className="agent-connections">
      <header className="agent-connections__header">
        <Heading as="h1" size="6">
          Connect an agent
        </Heading>
        <Text as="p">
          Set up an agent to use learning guidance from <strong>{data.repositoryName}</strong>.
        </Text>
      </header>

      <section aria-labelledby="agent-setup-title" className="agent-connections__section">
        <Heading as="h2" id="agent-setup-title" size="4">
          Add Hub to your agent
        </Heading>
        <Text as="p">
          Copy this configuration into your agent. It contains the Hub address for this repository,
          not a password or access token. Your agent will open a browser when it needs you to sign
          in.
        </Text>
        <CopyableCodeBlock code={configuration} label="Hub MCP configuration" />
      </section>

      <section aria-labelledby="agent-list-title" className="agent-connections__section">
        <Heading as="h2" id="agent-list-title" ref={connectionsHeadingRef} size="4" tabIndex={-1}>
          Your connected agents
        </Heading>
        <Text as="p">
          Connected as {data.signedInAs}. These agents can use your Hub access for any repository
          you can access.
        </Text>
        {connections.length ? (
          <ul className="agent-connections__list">
            {connections.map((connection) => (
              <li className="agent-connections__item" key={connection.id}>
                <div>
                  <strong>{connection.name}</strong>
                  <span>
                    Connected{" "}
                    <time dateTime={connection.connectedAt}>{connection.connectedAt}</time>
                    {" · "}Last used{" "}
                    <time dateTime={connection.lastUsedAt}>{connection.lastUsedAt}</time>
                  </span>
                </div>
                <Button
                  aria-label={`Revoke ${connection.name} access`}
                  onClick={() => setConnectionToRevoke(connection.id)}
                  type="button"
                  variant="secondary"
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Text as="p">No agents are connected to your Hub account.</Text>
        )}
      </section>

      {selectedConnection ? (
        <CanvasDialog
          title="Revoke agent access?"
          closeLabel="Close revoke confirmation"
          returnFocusRef={connectionsHeadingRef}
          onClose={() => setConnectionToRevoke(null)}
        >
          <div className="agent-connections__revoke-dialog">
            <Text as="p">
              {selectedConnection.name} will no longer be able to use your Hub account. This does
              not sign you out of Hub or change your repository access.
            </Text>
            <div className="agent-connections__actions">
              <Button onClick={() => setConnectionToRevoke(null)} type="button" variant="subtle">
                Cancel
              </Button>
              <Button onClick={revokeConnection} type="button" variant="primary">
                Revoke access
              </Button>
            </div>
          </div>
        </CanvasDialog>
      ) : null}
      {notice ? <HubToast title={notice} /> : null}
    </div>
  )
}
