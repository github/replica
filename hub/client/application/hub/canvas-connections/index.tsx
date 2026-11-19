import { useFetcher, useLocation } from "react-router"

import { HubApplication } from "@application/hub-application"
import { FormBoundary } from "@application/hub/form-boundary"
import { CanvasPairingsPage } from "@pages/canvas-pairings-page"
import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

export function CanvasConnectionScreen({
  page,
  returnTo,
}: {
  page: CanvasPairingsPageData | null
  returnTo: string
}) {
  const fetcher = useFetcher<{ error?: string; notice?: string }>()
  const { pathname, search } = useLocation()
  if (!page) return <HubApplication canvasReturnTo={returnTo} />
  const busy = fetcher.state !== "idle"
  return (
    <FormBoundary
      busy={busy}
      error={busy ? null : fetcher.data?.error}
      onSubmit={(form) => {
        void fetcher.submit(form, { method: "post", action: `${pathname}${search}` })
      }}
    >
      <CanvasPairingsPage
        busy={busy}
        data={
          page.kind === "connections"
            ? { ...page, notice: busy ? page.notice : (fetcher.data?.notice ?? page.notice) }
            : page
        }
      />
    </FormBoundary>
  )
}
