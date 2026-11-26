import { usePageData } from "@hooks/use-page-data"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import { useControlQuery } from "@hooks/use-prototype-control-query"
import { useShareFullScreenPreview } from "@hooks/use-share-full-screen-preview"
import { BuildsIndexPage } from "@pages/builds-index-page"
import type { BuildsIndexPageData } from "@pages/builds-index-page/types"

export default function BuildsIndexView() {
  const data = useRepositoryInbox(usePageData<BuildsIndexPageData>())
  const controls = useControlQuery()
  const previewPreference = useShareFullScreenPreview()
  return (
    <BuildsIndexPage
      data={data}
      controlQuery={controls.query}
      fullScreenPreview={previewPreference.fullScreenPreview}
      preferenceError={previewPreference.error}
    />
  )
}
