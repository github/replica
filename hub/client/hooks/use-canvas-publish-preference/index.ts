import { useCallback, useEffect, useRef, useState } from "react"

import { request } from "@utils/prototype-canvas-request"
import type { PublishPreparation } from "@utils/prototype-canvas/types"
import { publishChangesCopy as copy } from "./en"

export function usePublishPreference({
  token,
  enabled,
  repository,
  branch,
  commitSha,
  publicationRevision,
}: {
  token: string
  enabled: boolean
  repository?: string
  branch?: string
  commitSha?: string
  publicationRevision?: string | null
}) {
  const identity = `${repository}/${branch}/${commitSha}/${publicationRevision}`
  const [record, setRecord] = useState<{
    identity: string
    preparation: PublishPreparation | null
    error: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const writing = useRef<Promise<void> | null>(null)
  const revision = useRef(0)
  const current = enabled && record?.identity === identity ? record : null

  const load = useCallback(async () => {
    if (!enabled) return

    const requestId = ++revision.current
    setLoading(true)
    try {
      await writing.current
      if (requestId !== revision.current) return

      const preparation = await request<PublishPreparation>("/api/publish/prepare", token, {
        method: "POST",
        body: "{}",
      })
      if (requestId !== revision.current) return
      if (preparation.target.repository !== repository || preparation.target.branch !== branch)
        throw new Error(copy.preferenceTargetChanged)
      if (typeof preparation.remember !== "boolean") throw new Error(copy.invalidPreference)

      setRecord({ identity, preparation, error: "" })
    } catch (cause) {
      if (requestId === revision.current)
        setRecord({
          identity,
          preparation: null,
          error: cause instanceof Error ? cause.message : String(cause),
        })
    } finally {
      if (requestId === revision.current) setLoading(false)
    }
  }, [enabled, token, repository, branch, identity])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => {
      revision.current += 1
      window.clearTimeout(timer)
    }
  }, [load])

  async function save(remember: boolean) {
    if (!enabled || !current?.preparation || loading || writing.current) return

    setSaving(true)
    const requestId = revision.current
    const preparation = current.preparation
    const pending = (async () => {
      try {
        const result = await request<{ remember: boolean }>("/api/publish/preference", token, {
          method: "POST",
          body: JSON.stringify({ target: preparation.target, remember }),
        })
        if (result.remember !== remember) throw new Error(copy.invalidPreference)
        if (requestId === revision.current)
          setRecord({
            identity,
            preparation: { ...preparation, remember },
            error: "",
          })
      } catch (cause) {
        if (requestId === revision.current)
          setRecord({
            identity,
            preparation,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      }
    })()
    writing.current = pending
    try {
      await pending
    } finally {
      writing.current = null
      setSaving(false)
    }
  }

  return {
    remember: current?.preparation?.remember ?? null,
    loading: loading || !current,
    saving,
    error: current?.error || "",
    save,
    retry: load,
  }
}
