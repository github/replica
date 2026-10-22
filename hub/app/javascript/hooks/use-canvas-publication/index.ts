import { useEffect, useRef, useState } from "react"

import { presentPrototypeState } from "@utils/present-prototype-state"
import { request } from "@utils/prototype-canvas-request"
import { resolvePublication, type Publication } from "@utils/resolve-prototype-publication"
import { publicationCopy } from "@utils/resolve-prototype-publication/en"
import { publishChangesCopy } from "@hooks/use-canvas-publish-preference/en"
import type {
  HubStatus,
  PrototypeState,
  PublishMode,
  PublishPreparation,
} from "@utils/prototype-canvas/types"

type Props = {
  token: string
  state: PrototypeState | null
  hubStatus: HubStatus | null
  error: string
  setError: (message: string) => void
  refresh: (force: boolean) => Promise<void>
  refreshHub: () => Promise<void>
  preferenceSaving?: boolean
}

/** Keeps verified Build evidence separate from local-change publishing choices. */
export function useCanvasPublication({
  token,
  state,
  hubStatus,
  error,
  setError,
  refresh,
  refreshHub,
  preferenceSaving = false,
}: Props) {
  const [notice, setNotice] = useState("")
  const [publishing, setPublishing] = useState(false)
  const [failure, setFailure] = useState<{ message: string; identity: string } | null>(null)
  const inFlight = useRef(false)
  const [publishDialog, setPublishDialog] = useState<{
    preparation: PublishPreparation
  } | null>(null)
  const [publishDialogError, setPublishDialogError] = useState("")
  const [checking, setChecking] = useState(false)
  const resolved: Publication =
    !state && error
      ? { kind: "unknown", action: "retry", label: publicationCopy.retry, detail: error }
      : resolvePublication(state, hubStatus)
  const identity = `${state?.stats.repository}/${state?.stats.branch}/${state?.stats.commitSha}`
  const publication: Publication =
    failure?.identity === identity && resolved.action === "publish"
      ? {
          ...resolved,
          kind: "failed",
          detail: failure.message,
          label: publicationCopy.retryPublish,
        }
      : resolved.kind === "ready" && state?.stats.workingTree === "changed"
        ? {
            ...resolved,
            kind: "needs_push",
            action: "publish",
            label: publicationCopy.publishChanges,
            detail: publicationCopy.localChanges,
          }
        : resolved
  const presented = presentPrototypeState(state, hubStatus, resolved)

  useEffect(() => {
    if (presented.comparisonOutdated) void refresh(true)
  }, [
    presented.comparisonOutdated,
    hubStatus?.branch,
    hubStatus?.commitSha,
    hubStatus?.repository,
    refresh,
  ])

  async function retry() {
    if (checking) return

    setChecking(true)
    try {
      await Promise.all([refresh(true), refreshHub()])
    } finally {
      setChecking(false)
    }
  }

  async function publish() {
    if (preferenceSaving) return

    if (publication.action === "retry") {
      await retry()
      return
    }
    if (publication.action === "none" || inFlight.current || publishDialog) return

    await prepareAndPublish()
  }

  async function prepareAndPublish() {
    if (preferenceSaving || inFlight.current) return

    inFlight.current = true
    setPublishing(true)
    setError("")
    setPublishDialogError("")
    try {
      const preparation = await request<PublishPreparation>("/api/publish/prepare", token, {
        method: "POST",
        body: "{}",
      })
      if (
        preparation.workingTree === "unavailable" ||
        (preparation.workingTree === "changed" && !preparation.remember)
      ) {
        setPublishDialog({ preparation })
      } else {
        setPublishDialog(null)
        await performPublish(
          preparation,
          preparation.workingTree === "changed" ? "commit-changes" : "committed-only",
        )
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      setPublishDialogError(message)
    } finally {
      inFlight.current = false
      setPublishing(false)
    }
  }

  async function performPublish(
    preparation: PublishPreparation,
    mode: PublishMode,
    remember?: boolean,
  ) {
    if (
      mode === "committed-only" &&
      hubStatus?.state === "connected" &&
      hubStatus.repository === preparation.target.repository &&
      hubStatus.branch === preparation.target.branch &&
      hubStatus.prototype?.registered &&
      hubStatus.prototype.published &&
      hubStatus.prototype.build?.commitSha === preparation.target.commitSha &&
      state?.stats.remoteBranch?.state === "present" &&
      state.stats.remoteBranch.remoteSha === preparation.target.commitSha
    ) {
      setPublishDialog(null)
      return
    }
    setFailure(null)
    setPublishDialogError("")
    setError("")
    try {
      const result = await request<{ message: string }>("/api/publish", token, {
        method: "POST",
        body: JSON.stringify({
          target: preparation.target,
          workingTree: preparation.workingTree,
          mode,
          remember,
        }),
      })
      setPublishDialog(null)
      setNotice(result.message)
      await refreshHub()
      await refresh(false)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setFailure({ message, identity })
      setError(message)
      setPublishDialogError(message)
    }
  }

  async function choosePublish(mode: PublishMode, remember: boolean) {
    if (preferenceSaving || !publishDialog || inFlight.current) return
    if (publishDialog.preparation.workingTree === "unavailable" && mode !== "committed-only") {
      setPublishDialogError(publishChangesCopy.checkFailed)
      return
    }
    inFlight.current = true
    setPublishing(true)
    try {
      await performPublish(publishDialog.preparation, mode, remember)
    } finally {
      inFlight.current = false
      setPublishing(false)
    }
  }

  return {
    publication,
    presentedState: presented.state,
    busy: publishing || checking || preferenceSaving,
    notice,
    publishDialog,
    publishDialogError,
    closePublishDialog: () => setPublishDialog(null),
    choosePublish,
    retryPublishCheck: prepareAndPublish,
    publish,
    retry,
  }
}
