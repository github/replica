import { useContext } from "react"

import { MentionSourceContext } from "./context"

export function useMentionSource() {
  return useContext(MentionSourceContext)
}
