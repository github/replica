import type { PropsWithChildren } from "react"

import { FlowFormBoundary } from "../../form-boundary"

import "./styles.css"

export function SettingsFormBoundary({
  children,
  busy,
  error,
  notice,
  mock = false,
  onSubmit,
}: PropsWithChildren<{
  busy: boolean
  error?: string | null
  notice?: string | null
  mock?: boolean
  onSubmit: (input: FormData) => void
}>) {
  return (
    <div className={`settings-form-boundary${mock ? " settings-form-boundary--mock" : ""}`}>
      <FlowFormBoundary busy={busy} error={error} notice={notice} onSubmit={onSubmit}>
        {busy ? <div role="status">Updating settings…</div> : null}
        <div className="settings-form-boundary__content">{children}</div>
      </FlowFormBoundary>
    </div>
  )
}
