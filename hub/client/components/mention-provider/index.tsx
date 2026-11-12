import type { ReactNode } from "react"

import { MentionSourceContext } from "@hooks/use-mention-source/context"
import type { MentionSource } from "@hooks/use-mention-source/context"

export function MentionProvider({
  source,
  children,
}: {
  source: MentionSource
  children: ReactNode
}) {
  return <MentionSourceContext value={source}>{children}</MentionSourceContext>
}
