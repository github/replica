import { useSelector } from "react-redux"

import type { AppState } from "@application/store"
import { usePageData } from "@hooks/use-page-data"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import { usePrototypeListing } from "@hooks/use-prototype-listing"
import { RepositoriesShowPage } from "@pages/repositories-show-page"
import type { RepositoriesShowPageData } from "@pages/repositories-show-page/types"

export default function RepositoriesShowView() {
  const data = useRepositoryInbox(usePageData<RepositoriesShowPageData>())
  const controls = usePrototypeListing(data.listing)
  const managingPrototypes = useSelector(
    (state: AppState) => state.navigationRequest.path === data.managePrototypesPath,
  )

  return (
    <RepositoriesShowPage data={data} controls={controls} managingPrototypes={managingPrototypes} />
  )
}
