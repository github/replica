import { CopyIcon } from "@primer/octicons-react"
import { TextInput } from "@primer/react-brand"
import { useState } from "react"

import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import "./styles.css"

type CopyableTextInputProps = {
  value: string
  label: string
  copyLabel: string
  copiedLabel: string
  copyErrorLabel: string
  compact?: boolean
}

export function CopyableTextInput({
  value,
  label,
  copyLabel,
  copiedLabel,
  copyErrorLabel,
  compact = false,
}: CopyableTextInputProps) {
  const [copyResult, setCopyResult] = useState<{
    value: string
    status: "copied" | "failed"
  } | null>(null)
  const status = copyResult?.value === value ? copyResult.status : null
  const buttonLabel = status === "copied" ? copiedLabel : copyLabel

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopyResult({ value, status: "copied" })
    } catch {
      setCopyResult({ value, status: "failed" })
    }
  }

  return (
    <div className={`copyable-text-input${compact ? " copyable-text-input--compact" : ""}`}>
      <div className="copyable-text-input__control">
        {compact ? (
          <input
            type="text"
            value={value}
            aria-label={label}
            readOnly
            className="copyable-text-input__input"
          />
        ) : (
          <TextInput
            value={value}
            aria-label={label}
            readOnly
            fullWidth
            className="copyable-text-input__input"
          />
        )}

        <HubIconButton
          icon={CopyIcon}
          aria-label={buttonLabel}
          description={compact ? buttonLabel : undefined}
          title={compact ? undefined : buttonLabel}
          variant="invisible"
          size="small"
          className="copyable-text-input__button"
          onClick={() => void copy()}
        />
      </div>

      <HubVisuallyHidden aria-live="polite" aria-atomic="true">
        {status === "copied" ? copiedLabel : ""}
      </HubVisuallyHidden>

      {status === "failed" ? (
        <span role="alert" className="copyable-text-input__error">
          {copyErrorLabel}
        </span>
      ) : null}
    </div>
  )
}
