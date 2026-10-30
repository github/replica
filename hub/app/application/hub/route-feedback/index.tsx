import { Button, Heading, Text } from "@primer/react-brand"

import { ReplicaLogo } from "@components/replica-logo"

import "./styles.css"

interface Props {
  kind: "loading" | "error"
  heading: string
  description: string
  status?: number
  onRetry?: () => void
  retrying?: boolean
}

export function RouteFeedback({
  kind,
  heading,
  description,
  status,
  onRetry,
  retrying = false,
}: Props) {
  return (
    <main className="hub-route-feedback" tabIndex={-1}>
      <div className="hub-route-feedback__content" role={kind === "error" ? "alert" : "status"}>
        <div className="hub-route-feedback__logo" aria-hidden="true">
          <ReplicaLogo />
        </div>
        {status !== undefined ? <Text size="100">{status}</Text> : null}
        <Heading as="h1" size="4">
          {heading}
        </Heading>
        <Text as="p" variant="muted">
          {description}
        </Text>
        {kind === "error" ? (
          <div className="hub-route-feedback__actions">
            {onRetry ? (
              <Button variant="primary" onClick={onRetry} disabled={retrying}>
                {retrying ? "Retrying..." : "Try again"}
              </Button>
            ) : null}
            <Button as="a" href="/" variant="secondary">
              Repositories
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  )
}
