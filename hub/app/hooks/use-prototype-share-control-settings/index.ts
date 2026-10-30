import { useMemo, useState } from "react"

import type { ControlValues } from "@utils/prototype-controls-url/constants"
import { encodeControlValues } from "@utils/prototype-controls-url/encode-control-values"

export function useShareControlSettings(
  identity: string | undefined,
  values: ControlValues,
  remote?: {
    included: boolean
    error?: string
    revision?: string
    onChange: (included: boolean) => Promise<void>
  },
) {
  const remoteIncluded = remote?.included
  const remoteError = remote?.error
  const revision = remote?.revision
  const initialPreference = useMemo(() => {
    if (remoteIncluded !== undefined)
      return {
        identity,
        revision,
        included: remoteIncluded,
        error: remoteError ?? "",
        pending: false,
      }
    let included = false
    let error = ""
    if (identity) {
      try {
        const stored = localStorage.getItem(`replica:share-controls:v1:${identity}`)
        if (stored !== null && stored !== "true" && stored !== "false")
          throw new Error("Invalid saved share preference.")
        included = stored === "true"
      } catch {
        error = "The share preference could not be read. Control settings are off by default."
      }
    }
    return { identity, revision, included, error, pending: false }
  }, [identity, revision, remoteIncluded, remoteError])
  const [preference, setPreference] = useState(initialPreference)
  const current =
    preference.identity === identity && preference.revision === revision
      ? preference
      : initialPreference
  let query = ""
  let queryError = ""
  if (current.included) {
    try {
      query = encodeControlValues(values)
    } catch (error) {
      queryError = error instanceof Error ? error.message : "Control settings could not be shared."
    }
  }
  return {
    included: current.included,
    query,
    error: queryError || current.error,
    blocked: Boolean(queryError),
    ...(remote ? { pending: current.pending } : {}),
    onChange: (included: boolean) => {
      if (remote) {
        setPreference({ identity, revision, included, error: "", pending: true })
        function finish(error: string) {
          setPreference((previous) =>
            previous.identity === identity &&
            previous.revision === revision &&
            previous.included === included
              ? { ...previous, error, pending: false }
              : previous,
          )
        }
        void remote.onChange(included).then(
          () => finish(""),
          (error: unknown) =>
            finish(
              error instanceof Error
                ? error.message
                : "This preference could not be saved. It will only apply while this page is open.",
            ),
        )
        return
      }
      let error = ""
      if (identity) {
        try {
          localStorage.setItem(`replica:share-controls:v1:${identity}`, String(included))
        } catch {
          error = "This preference could not be saved. It will only apply while this page is open."
        }
      }
      setPreference({ identity, revision, included, error, pending: false })
    },
  }
}
