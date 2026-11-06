import { useEffect, useState } from "react"

import type { HubStatus, PrototypeState } from "@utils/prototype-canvas/types"

type Props = {
  token: string
  state: PrototypeState | null
  hubStatus: HubStatus | null
}

type Intent = {
  repository: string | undefined
  branch: string | undefined
  hubOrigin: string | undefined
  token: string
  connecting: boolean
  stale: boolean
}

/** Pins an open sharing flow to its original checkout rather than silently retargeting it. */
export function useShareIntent({ token, state, hubStatus }: Props) {
  const [intent, setIntent] = useState<Intent | null>(null)
  const targetChanged = Boolean(
    intent &&
    (intent.stale ||
      (intent.repository !== undefined && intent.repository !== state?.stats.repository) ||
      (intent.branch !== undefined && intent.branch !== state?.stats.branch) ||
      (hubStatus?.hubOrigin !== undefined &&
        intent.hubOrigin !== undefined &&
        intent.hubOrigin !== hubStatus.hubOrigin) ||
      intent.token !== token),
  )

  useEffect(() => {
    if (!intent || intent.stale) return

    const repository = intent.repository ?? state?.stats.repository
    const branch = intent.branch ?? state?.stats.branch
    const hubOrigin = intent.hubOrigin ?? hubStatus?.hubOrigin
    if (
      !targetChanged &&
      repository === intent.repository &&
      branch === intent.branch &&
      hubOrigin === intent.hubOrigin
    )
      return

    const timeout = window.setTimeout(() => {
      setIntent(
        (current) =>
          current && {
            ...current,
            repository,
            branch,
            hubOrigin,
            stale: targetChanged,
            connecting: targetChanged ? false : current.connecting,
          },
      )
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [intent, targetChanged, state?.stats.repository, state?.stats.branch, hubStatus?.hubOrigin])

  function begin() {
    setIntent({
      repository: state?.stats.repository,
      branch: state?.stats.branch,
      hubOrigin: hubStatus?.hubOrigin,
      token,
      connecting: false,
      stale: false,
    })
  }

  function setConnecting(connecting: boolean) {
    setIntent((current) => current && { ...current, connecting })
  }

  return { intent, targetChanged, begin, close: () => setIntent(null), setConnecting }
}
