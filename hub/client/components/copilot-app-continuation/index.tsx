import { CopyIcon } from "@primer/octicons-react"
import { Button, InlineLink, Text } from "@primer/react-brand"
import { useState } from "react"
import type { MouseEvent } from "react"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import type { CopilotAppContinuationCopy, CopilotAppSubmission } from "./types"

import "./styles.css"

export function CopilotAppContinuation({
  submission,
  copy,
  onOpenApp,
}: {
  submission: CopilotAppSubmission
  copy: CopilotAppContinuationCopy
  onOpenApp?: (url: string) => void
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle")

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(submission.prompt)
      setCopyState("copied")
    } catch {
      setCopyState("error")
    }
  }

  return (
    <div className="copilot-app-continuation">
      <Text as="p" size="100" className="copilot-app-continuation__message">
        {copy.continueMessage} {copy.installMessage}{" "}
        <InlineLink href={copy.downloadUrl}>{copy.downloadLabel}</InlineLink>.
      </Text>

      <div className="copilot-app-continuation__actions">
        <Button
          as="a"
          href={submission.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="primary"
          size="small"
          aria-label={copy.openAppLabel}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (onOpenApp) {
              event.preventDefault()
              onOpenApp(submission.url)
            }
          }}
        >
          {copy.openAppLabel}
        </Button>

        <Button
          type="button"
          variant="subtle"
          size="small"
          leadingVisual={CopyIcon}
          onClick={() => void copyPrompt()}
        >
          {copyState === "copied" ? copy.copiedLabel : copy.copyPromptLabel}
        </Button>
      </div>

      <HubVisuallyHidden role="status">
        {copyState === "copied" ? copy.copiedLabel : ""}
      </HubVisuallyHidden>

      {copyState === "error" ? (
        <p className="copilot-app-continuation__copy-error" role="alert">
          {copy.copyErrorLabel}
        </p>
      ) : null}
    </div>
  )
}
