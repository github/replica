import { useState } from "react"
import { Box, Text } from "ink"
import { TextInput } from "@inkjs/ui"

import { InputValidationError } from "../../config/fields/index.ts"
import type { FieldDefinition } from "../../types.ts"
import { terminalColors } from "../theme/index.ts"

export function FieldPrompt({
  field,
  initialValue = "",
  onSubmit,
  onError,
  onEdit,
  onFeedback,
}: {
  field: FieldDefinition
  initialValue?: string
  onSubmit: (value: string) => void
  onError: (error: Error) => void
  onEdit?: (value: string) => void
  onFeedback?: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string>()
  const [submitted, setSubmitted] = useState(false)
  const [revision, setRevision] = useState(0)
  const failed = (failure: unknown) =>
    onError(failure instanceof Error ? failure : new Error("Unexpected field validation failure."))

  function change(raw: string) {
    setValue(raw)
    try {
      if (submitted) {
        field.parse(raw)
        setError(undefined)
      } else setError(field.editingError?.(raw))
    } catch (failure) {
      if (!(failure instanceof InputValidationError)) return failed(failure)
      setError(failure.message)
    }
    onEdit?.(raw)
    onFeedback?.()
  }
  function submit(raw: string) {
    let checked: string
    try {
      checked = field.parse(raw)
    } catch (failure) {
      if (!(failure instanceof InputValidationError)) return failed(failure)
      setSubmitted(true)
      setError(failure.message)
      if (field.clearRejected || /[\u0000-\u001f\u007f]/.test(raw)) {
        setValue("")
        setRevision((value) => value + 1)
        onEdit?.("")
      }
      onFeedback?.()
      return
    }
    onSubmit(checked)
  }
  return (
    <Box flexDirection="column">
      <Text bold>{field.label}</Text>
      <Text>{field.help}</Text>
      <Box marginTop={1}>
        <Text color={terminalColors.accent}>{"> "}</Text>
        <TextInput key={revision} defaultValue={value} onChange={change} onSubmit={submit} />
      </Box>
      {error && <Text color={terminalColors.error}>Error: {error}</Text>}
    </Box>
  )
}
