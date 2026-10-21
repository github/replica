import { usePageData } from "@hooks/use-page-data"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import { usePageSection } from "@hooks/use-page-section"

import { PrototypeManagementPage } from "@pages/prototype-management-page"
import type { PrototypeManagementPageData } from "@pages/prototype-management-page/types"

export default function PrototypeManagementShowView() {
  const data = useRepositoryInbox(usePageData<PrototypeManagementPageData>())
  const candidates = usePageSection(data.management.candidateDataPath, data.sectionLoadId)
  const repositories = usePageSection(data.repositoryChoices.path, data.sectionLoadId)

  return (
    <PrototypeManagementPage data={data} candidates={candidates} repositoryChoices={repositories} />
  )
}
