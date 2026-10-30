import { useEffect, useRef } from "react"
import type { PropsWithChildren, SubmitEvent } from "react"

import { HubAlert } from "@components/hub-alert"

interface Props extends PropsWithChildren {
  busy: boolean
  error?: string | null
  notice?: string | null
  onSubmit: (data: FormData) => void
}

export function FlowFormBoundary({ children, busy, error, notice, onSubmit }: Props) {
  const feedback = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) feedback.current?.focus()
  }, [error])

  function submit(event: SubmitEvent<HTMLDivElement>) {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return
    if (["get", "dialog"].includes(event.target.method.toLowerCase())) return
    event.preventDefault()
    if (busy) return
    const submitter = event.nativeEvent.submitter
    const input = new FormData(event.target, submitter)
    const action = new URL(event.target.action, window.location.href)
    input.set("_action", `${action.pathname}${action.search}`)
    input.set("_formMethod", event.target.method.toUpperCase())
    onSubmit(input)
  }

  return (
    <div onSubmit={submit} aria-busy={busy}>
      {error || notice ? (
        <div ref={feedback} tabIndex={-1} role={error ? "alert" : "status"}>
          <HubAlert title={error || notice || ""} variant={error ? "critical" : "success"} />
        </div>
      ) : null}
      {children}
    </div>
  )
}
