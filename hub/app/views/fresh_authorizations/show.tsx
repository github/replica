import { useEffect, useRef } from "react"

import { usePageData } from "@hooks/use-page-data"
import { useWorkspaceInbox } from "@hooks/use-workspace-inbox"
import { FreshAuthorizationPage } from "@pages/fresh-authorization-page"
import type { FreshAuthorizationPageData } from "@pages/fresh-authorization-page/types"

export default function FreshAuthorizationsShowView() {
  const data = useWorkspaceInbox(usePageData<FreshAuthorizationPageData>())
  const form = useRef<HTMLFormElement>(null)
  const submitted = useRef(false)

  useEffect(() => {
    if (!data.continuation || submitted.current || !form.current) return

    submitted.current = true
    form.current.requestSubmit()
  }, [data.continuation])

  return <FreshAuthorizationPage data={data} continuationFormRef={form} />
}
