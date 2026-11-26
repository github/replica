import { useCallback, useEffect, useState } from "react"

import { changeEvent, storageKey } from "./constants"
import { previewPreferenceCopy } from "./en"

export function useShareFullScreenPreview() {
  const readPreference = useCallback(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null && saved !== "true" && saved !== "false")
        throw new Error(previewPreferenceCopy.invalid)
      return { fullScreenPreview: saved !== "false", error: "" }
    } catch {
      return {
        fullScreenPreview: true,
        error: previewPreferenceCopy.readError,
      }
    }
  }, [])
  const [preference, setPreference] = useState(readPreference)

  useEffect(() => {
    function changed() {
      setPreference(readPreference())
    }
    window.addEventListener(changeEvent, changed)
    window.addEventListener("storage", changed)
    return () => {
      window.removeEventListener(changeEvent, changed)
      window.removeEventListener("storage", changed)
    }
  }, [readPreference])

  return {
    ...preference,
    onChange: (fullScreenPreview: boolean) => {
      let error = ""
      try {
        localStorage.setItem(storageKey, String(fullScreenPreview))
        window.dispatchEvent(new Event(changeEvent))
      } catch {
        error = previewPreferenceCopy.writeError
      }
      setPreference({ fullScreenPreview, error })
    },
  }
}
