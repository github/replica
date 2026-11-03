import { useEffect, useState } from "react"

import { controlsUrlEvent } from "@utils/prototype-controls-url/constants"
import { readControlQuery } from "@utils/prototype-controls-url/read-control-query"
import { encodeControlValues } from "@utils/prototype-controls-url/encode-control-values"

export function useControlQuery() {
  const [, refresh] = useState(0)
  useEffect(() => {
    function changed() {
      refresh((revision) => revision + 1)
    }
    window.addEventListener(controlsUrlEvent, changed)
    window.addEventListener("popstate", changed)
    return () => {
      window.removeEventListener(controlsUrlEvent, changed)
      window.removeEventListener("popstate", changed)
    }
  }, [])
  const { scopes: values, notice } = readControlQuery(window.location.search)
  try {
    return { values, query: encodeControlValues(values), notice }
  } catch (error) {
    return {
      values,
      query: "",
      notice: error instanceof Error ? error.message : "URL control settings could not be read.",
    }
  }
}
