import type { ChangeEventHandler, ReactNode, SubmitEventHandler } from "react"

export interface ShareLinksFormData {
  buildLabel: string | null
  expirationLabel: string
  expirationOptions: Array<{ label: string; value: string }>
  labelLabel: string
  labelMaximumBytes: number
  labelPlaceholder: string
  submitLabel: string
}

type ShareLinksFormFields = {
  data: ShareLinksFormData
  hiddenFields?: ReactNode
  details?: ReactNode
  afterFields?: ReactNode
  label?: string
  onLabelChange?: ChangeEventHandler<HTMLInputElement>
  expiration?: string
  onExpirationChange?: ChangeEventHandler<HTMLSelectElement>
  disabled?: boolean
  fieldsDisabled?: boolean
  busy?: boolean
  error?: string
}

export type ShareLinksFormProps = ShareLinksFormFields &
  (
    | { action: string; onSubmit?: never }
    | { action?: never; onSubmit: SubmitEventHandler<HTMLFormElement> }
  )
