import type { PropsWithChildren } from "react"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { FormBoundary } from "@application/hub/form-boundary"

import "./styles.css"

export function SettingsFormBoundary({
  children,
  busy,
  error,
  notice,
  onSubmit,
  shouldIntercept,
}: PropsWithChildren<{
  busy: boolean
  error?: string | null
  notice?: string | null
  onSubmit: (input: FormData) => void
  shouldIntercept?: (form: HTMLFormElement) => boolean
}>) {
  return (
    <div className="settings-form-boundary">
      <FormBoundary
        busy={busy}
        error={error}
        notice={notice}
        onSubmit={onSubmit}
        shouldIntercept={shouldIntercept}
      >
        {busy ? <HubVisuallyHidden role="status">Updating settings…</HubVisuallyHidden> : null}
        <div className="settings-form-boundary__content">{children}</div>
      </FormBoundary>
    </div>
  )
}
