import type { PropsWithChildren } from "react"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import { FlowFormBoundary } from "../../form-boundary"

import "./styles.css"

export function SettingsFormBoundary({
  children,
  busy,
  error,
  notice,
  onSubmit,
}: PropsWithChildren<{
  busy: boolean
  error?: string | null
  notice?: string | null
  onSubmit: (input: FormData) => void
}>) {
  return (
    <div className="settings-form-boundary">
      <FlowFormBoundary busy={busy} error={error} notice={notice} onSubmit={onSubmit}>
        {busy ? <HubVisuallyHidden role="status">Updating settings…</HubVisuallyHidden> : null}
        <div className="settings-form-boundary__content">{children}</div>
      </FlowFormBoundary>
    </div>
  )
}
