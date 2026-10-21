import { ArrowLeftIcon } from "@primer/octicons-react"
import { Heading } from "@primer/react-brand"

import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { PrototypeMetadataManagement } from "@features/prototype-metadata-management"
import { RepositoryWorkspace } from "@features/repository-workspace"

import type { PageSectionState, PrototypeManagementPageData } from "./types"

import "./styles.css"

/** Gives repository writers one place to add branches and edit gallery details. */
export function PrototypeManagementPage({
  data,
  candidates,
  repositoryChoices,
}: {
  data: PrototypeManagementPageData
  candidates?: PageSectionState
  repositoryChoices?: PageSectionState
}) {
  return (
    <RepositoryWorkspace
      data={{ ...data, repositories: data.repositoryChoices.repositories }}
      repositoryChoices={{
        ...data.repositoryChoices,
        loading: repositoryChoices?.loading ?? false,
        failed: (repositoryChoices?.failed ?? false) || data.repositoryChoices.failed,
        onRetry: repositoryChoices?.retry,
      }}
    >
      <div className="prototype-management-page">
        <header className="repository-page-header prototype-management-page__header">
          <HubIconButton
            as="a"
            href={data.prototypesPath}
            data-sg-visit="true"
            icon={ArrowLeftIcon}
            variant="invisible"
            aria-label={data.backLabel}
          />

          <Heading as="h1" size="6">
            {data.pageTitle}
          </Heading>
        </header>

        <div className="prototype-management-page__content">
          {data.alert ? <HubAlert title={data.alert} variant="critical" layout="compact" /> : null}

          <PrototypeMetadataManagement
            authenticityToken={data.authenticityToken}
            data={data.management}
            loading={candidates?.loading}
            loadFailed={candidates?.failed}
            onRetry={candidates?.retry}
          />
        </div>
      </div>
    </RepositoryWorkspace>
  )
}
