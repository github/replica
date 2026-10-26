import { useContext, useEffect, useId } from "react"

import { ReviewErrorContext } from "./context"

export function useReviewError(message: string | null | false | undefined) {
  const feedback = useContext(ReviewErrorContext)
  const id = useId()
  const report = feedback?.report

  useEffect(() => {
    report?.(id, message || "")
    return () => report?.(id, "")
  }, [id, message, report])

  return !feedback && Boolean(message)
}
