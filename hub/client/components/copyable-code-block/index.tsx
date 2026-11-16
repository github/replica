import { CopyIcon } from "@primer/octicons-react"
import { useState } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import "./styles.css"

type Props = {
  code: string
  label: string
  copyLabel?: string
  copiedLabel?: string
  copyErrorLabel?: string
}

export function CopyableCodeBlock({
  code,
  label,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  copyErrorLabel = "Copy failed. Select the text and copy it manually.",
}: Props) {
  const [status, setStatus] = useState<"copied" | "failed" | null>(null)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setStatus("copied")
    } catch {
      setStatus("failed")
    }
  }

  return (
    <div className="copyable-code-block">
      <pre className="copyable-code-block__code" aria-label={label} tabIndex={0}>
        <code>{code}</code>
      </pre>

      <HubIconButton
        icon={CopyIcon}
        aria-label={`${status === "copied" ? copiedLabel : copyLabel}: ${label}`}
        title={status === "copied" ? copiedLabel : copyLabel}
        variant="invisible"
        size="small"
        className="copyable-code-block__button"
        onClick={() => void copy()}
      />

      <HubVisuallyHidden aria-live="polite" aria-atomic="true">
        {status === "copied" ? copiedLabel : ""}
      </HubVisuallyHidden>

      {status === "failed" ? (
        <span role="alert" className="copyable-code-block__error">
          {copyErrorLabel}
        </span>
      ) : null}
    </div>
  )
}
