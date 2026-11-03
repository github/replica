import { CheckIcon, CopyIcon } from "@primer/octicons-react"
import { Button } from "@primer/react-brand"
import { useEffect, useRef, useState } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import { copy } from "@utils/prototype-canvas/en"
import type { HubStatus } from "@utils/prototype-canvas/types"

import "./styles.css"

export function HubApproval({ pairing }: { pairing: NonNullable<HubStatus["pairing"]> }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle")
  const groupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    groupRef.current?.querySelector<HTMLAnchorElement>("a")?.focus()
  }, [])

  async function copyApprovalLink() {
    try {
      await navigator.clipboard.writeText(pairing.verificationUrl)
      setCopyStatus("copied")
    } catch {
      setCopyStatus("failed")
    }
  }

  return (
    <section className="hub-connection-approval" aria-label={copy.connectionApproval}>
      <p role="status">
        {copy.connectionWaiting} <strong>{pairing.userCode}</strong>.
      </p>
      <div
        ref={groupRef}
        className="hub-connection-approval-actions"
        role="group"
        aria-label={copy.connectionApproval}
      >
        <Button
          as="a"
          variant="primary"
          size="medium"
          href={pairing.verificationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {copy.connectToHub}
        </Button>
        <HubIconButton
          icon={copyStatus === "copied" ? CheckIcon : CopyIcon}
          size="medium"
          className="hub-connection-approval-copy"
          aria-label={copyStatus === "copied" ? copy.approvalLinkCopied : copy.copyApprovalLink}
          onClick={() => void copyApprovalLink()}
        />
      </div>
      <HubVisuallyHidden role="status">
        {copyStatus === "copied" ? copy.approvalLinkCopied : ""}
      </HubVisuallyHidden>
      {copyStatus === "failed" ? <p role="alert">{copy.approvalCopyFailed}</p> : null}
    </section>
  )
}
