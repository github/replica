import { SyncIcon } from "@primer/octicons-react"
import { Button, InlineLink } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"

import type { Publication } from "@utils/resolve-prototype-publication"
import { publicationCopy as copy } from "@utils/resolve-prototype-publication/en"

import "./styles.css"

export function BranchPublication({
  publication,
  busy,
  onPublish,
  onRetry,
}: {
  publication: Publication
  dirty: boolean
  busy: boolean
  onPublish: () => void
  onRetry: () => void
}) {
  if (publication.kind === "ready") return null
  const pending = publication.kind === "requested"
  const loading = busy || pending

  return (
    <section className="canvas-branch-publication" aria-label={copy.heading}>
      {publication.error ? (
        <HubAlert
          variant="critical"
          layout="compact"
          title={publication.error.title}
          description={publication.error.description}
        />
      ) : (
        <p role="status">{publication.detail}</p>
      )}
      {publication.runUrl ? (
        <p>
          <InlineLink
            className="canvas-branch-publication__workflow-link"
            href={publication.runUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.workflowLink}
          </InlineLink>
        </p>
      ) : null}
      {(publication.action !== "none" || pending) && publication.kind !== "disconnected" ? (
        <div className="canvas-branch-publication__actions">
          <Button
            variant="primary"
            size="small"
            disabled={loading}
            aria-busy={loading}
            leadingVisual={loading ? <SyncIcon size={16} /> : undefined}
            onClick={publication.action === "retry" ? onRetry : onPublish}
          >
            {publication.label}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
