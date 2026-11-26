import { useRef, useState } from "react"
import { Button, Heading, Text } from "@primer/react-brand"

import { CanvasDialog } from "@components/prototype-canvas-dialog"
import { CopyableCodeBlock } from "@components/copyable-code-block"
import { HubToast } from "@components/hub-toast"

import type { AgentConnectionsPageData } from "./types"
import "./styles.css"

/**
 * Lets people approve a coding agent's request to use their Hub access, and review or
 * revoke the agents they already connected.
 */
export function AgentConnectionsPage({
  data,
  busy = false,
}: {
  data: AgentConnectionsPageData
  busy?: boolean
}) {
  const [connectionToRevoke, setConnectionToRevoke] = useState<string | null>(null)
  const connectionsHeadingRef = useRef<HTMLHeadingElement>(null)

  if (data.view === "approval") {
    return (
      <main className="agent-connections">
        <section aria-labelledby="agent-approval-title" className="agent-connections__approval">
          <Heading as="h1" id="agent-approval-title" size="5">
            Connect {data.requestingAgent} to Hub?
          </Heading>
          <Text as="p">
            You are signed in as <strong>@{data.signedInAs}</strong>. This agent can read guidance
            and report which learnings it applied for repositories you can access. Hub checks access
            on every request; only people can accept or change learnings.
          </Text>
          <Text as="p">
            This does not allow session-message storage, screenshot storage, or automated screenshot
            review. Those choices require separate consent.
          </Text>
          <Text as="p">{data.expiresLabel}</Text>
          <form action={data.decisionPath} className="agent-connections__actions" method="post">
            <Button disabled={busy} name="decision" type="submit" value="cancel" variant="subtle">
              Cancel
            </Button>
            <Button disabled={busy} name="decision" type="submit" value="approve" variant="primary">
              Approve access
            </Button>
          </form>
        </section>
      </main>
    )
  }

  const configuration = JSON.stringify({ mcpServers: { replica: { url: data.mcpUrl } } }, null, 2)
  const selectedConnection = data.connections.find(({ id }) => id === connectionToRevoke)

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
          Connected as @{data.signedInAs}. These agents can use your Hub access for any repository
          you can access.
        </Text>
        {data.connections.length ? (
          <ul className="agent-connections__list">
            {data.connections.map((connection) => (
              <li className="agent-connections__item" key={connection.id}>
                <div>
                  <strong>{connection.name}</strong>
                  <span>
                    {connection.connectedLabel} · {connection.lastUsedLabel}
                  </span>
                </div>
                <Button
                  aria-label={`Revoke ${connection.name} access`}
                  disabled={busy}
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
          <form
            action={selectedConnection.revokePath}
            className="agent-connections__revoke-dialog"
            method="post"
            onSubmit={() => setConnectionToRevoke(null)}
          >
            <input type="hidden" name="_method" value="delete" />
            <Text as="p">
              {selectedConnection.name} will no longer be able to use your Hub account. This does
              not sign you out of Hub or change your repository access.
            </Text>
            <div className="agent-connections__actions">
              <Button onClick={() => setConnectionToRevoke(null)} type="button" variant="subtle">
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Revoke access
              </Button>
            </div>
          </form>
        </CanvasDialog>
      ) : null}
      {data.notice ? <HubToast title={data.notice} /> : null}
    </div>
  )
}
