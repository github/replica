import { useLayoutEffect, useRef, useState } from "react"

import type { ControlFieldResult } from "@utils/prototype-controls-connection/types"
import { copy } from "@utils/prototype-canvas/en"

export function useControlDraft(
  value: unknown,
  onCommit: (value: unknown) => ControlFieldResult | Promise<ControlFieldResult>,
) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const current = useRef(value)
  const latest = useRef(value)
  const request = useRef(0)
  const pending = useRef(false)
  useLayoutEffect(() => {
    latest.current = value
    if (!pending.current) {
      current.current = value
      setDraft(value)
    }
  }, [value])
  useLayoutEffect(
    () => () => {
      request.current++
    },
    [],
  )
  function stage(next: unknown) {
    request.current++
    pending.current = true
    current.current = next
    setDraft(next)
    setError(null)
  }
  function reset() {
    request.current++
    pending.current = false
    current.current = latest.current
    setDraft(latest.current)
    setError(null)
  }
  function commit(next: unknown, candidate = next) {
    stage(next)
    const token = request.current
    void Promise.resolve()
      .then(() => onCommit(candidate))
      .then((result) => {
        if (request.current !== token) return
        pending.current = false
        current.current = result && "value" in result ? result.value : latest.current
        setDraft(current.current)
      })
      .catch(() => {
        if (request.current !== token) return
        reset()
        setError(copy.controlsValueNotApplied)
      })
  }
  return { draft, error, current: () => current.current, stage, commit, reset }
}
