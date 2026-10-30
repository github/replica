import { CheckIcon, CopyIcon, GitBranchIcon } from "@primer/octicons-react"
import { Button } from "@primer/react-brand"
import { useState, type RefObject } from "react"

import { CanvasDialog } from "../prototype-canvas-dialog"
import { copy } from "@utils/prototype-canvas/en"
import type { PrototypeState } from "@utils/prototype-canvas/types"

import "./styles.css"

type Props = {
  onClose: () => void
  state: PrototypeState
  titleButtonRef: RefObject<HTMLButtonElement | null>
}

export function BuildDetailsDialog({ onClose, state, titleButtonRef }: Props) {
  const [copied, setCopied] = useState<"branch" | "sessionId" | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const branch = state.stats.branchError ? undefined : state.stats.branch
  const sessionId = state.sessionId
  const comparison = state.stats.comparison

  async function handleCopy(value: string, field: "branch" | "sessionId") {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(field)
      setCopyError(null)
    } catch {
      setCopied(null)
      setCopyError(field === "branch" ? copy.branch : copy.sessionId)
    }
  }

  function copyButton(value: string | undefined, field: "branch" | "sessionId") {
    if (!value) return null
    const label = field === "branch" ? copy.copyBranch : copy.copySessionId
    const copiedLabel = field === "branch" ? copy.branchCopied : copy.sessionIdCopied
    return (
      <Button
        type="button"
        className="canvas-icon-button"
        variant="subtle"
        size="small"
        leadingVisual={copied === field ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        aria-label={copied === field ? copiedLabel : label}
        title={copied === field ? copiedLabel : label}
        onClick={() => void handleCopy(value, field)}
      >
        <span className="visually-hidden">{label}</span>
      </Button>
    )
  }

  return (
    <CanvasDialog
      title={copy.buildDetails}
      closeLabel={copy.closeBuildDetails}
      className="build-details-dialog"
      returnFocusRef={titleButtonRef}
      onClose={onClose}
    >
      <dl className="build-details-list">
        <div>
          <dt>{copy.branch}</dt>
          <dd>
            <GitBranchIcon size={16} aria-hidden="true" />
            <code>{branch || state.stats.branchError || copy.unavailable}</code>
            {copyButton(branch, "branch")}
          </dd>
        </div>
        <div>
          <dt>{copy.sessionId}</dt>
          <dd>
            <code>{sessionId || copy.unavailable}</code>
            {copyButton(sessionId, "sessionId")}
          </dd>
        </div>
        <div>
          <dt>
            {comparison?.branch
              ? `Behind ${comparison.branch}${comparison.source === "local" ? " (local)" : ""}`
              : copy.comparison}
          </dt>
          <dd>
            {comparison?.error ||
              (comparison?.behind === 0
                ? copy.upToDate
                : comparison?.behind != null
                  ? copy.commitsBehind(comparison.behind)
                  : copy.unavailable)}
          </dd>
        </div>
      </dl>
      <span role="status" aria-live="polite" className="visually-hidden">
        {copied === "branch"
          ? `${copy.branchCopied}.`
          : copied === "sessionId"
            ? `${copy.sessionIdCopied}.`
            : ""}
      </span>
      {copyError ? (
        <span role="alert" className="build-details-copy-error">
          {copy.buildDetailsCopyFailed(copyError)}
        </span>
      ) : null}
    </CanvasDialog>
  )
}
