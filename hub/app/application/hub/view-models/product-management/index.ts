import type { PrototypeManagementPageData } from "@pages/prototype-management-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { ProductManagementResponse } from "../../product-contracts"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

export function productManagementData(
  workspace: WorkspaceResponse,
  response: ProductManagementResponse,
  search: URLSearchParams,
): PrototypeManagementPageData {
  const base = `/repositories/${response.repository.id}`
  const common = repositoryWorkspace(workspace, response.repository, search)
  const path = resourcePath(`${base}/prototypes/manage`, search)
  return {
    ...common,
    newPrototypePath: response.canCreate ? resourcePath(`${base}/new`, search) : null,
    alert: response.canCreate
      ? null
      : "This mock profile can read prototype details but cannot change them.",
    backLabel: "Back to prototypes",
    pageTitle: "Manage prototypes",
    sectionLoadId: path,
    repositoryChoices: {
      repositories: common.repositories,
      path,
      loadingLabel: "Loading repositories...",
      errorLabel: "Repository choices could not be loaded.",
      retryLabel: "Retry",
      failed: false,
    },
    management: {
      heading: "Manage prototypes",
      unlistedHeading: "Available synthetic branches",
      unlistedDescription:
        "Add a synthetic branch to the local mock Hub. No GitHub discovery or workflow is performed.",
      registeredHeading: "Prototypes in the mock Hub",
      registeredEmptyLabel: "No prototypes have been added to this repository.",
      emptyLabel: "No synthetic branches are available to add.",
      nameLabel: "Name",
      descriptionLabel: "Description (optional)",
      startPageLabel: "Start page (optional)",
      startPageHint:
        "Save a local route as metadata, such as /welcome?step=1#intro. Synthetic Build contents are unchanged.",
      addLabel: "Add to mock Hub",
      editLabel: "Edit details",
      saveLabel: "Save details",
      cancelLabel: "Cancel",
      addDialogHeading: "Add synthetic branch",
      editDialogHeading: "Edit prototype details",
      closeDialogLabel: "Close dialog",
      nameMaximumLength: 120,
      descriptionMaximumLength: 4000,
      candidateCheckFailed: false,
      candidateCheckFailedLabel: "Available synthetic branches could not be loaded.",
      candidateLoadingLabel: "Loading synthetic branches...",
      candidateRetryLabel: "Retry",
      candidateDataPath: path,
      candidatePage: 1,
      candidatePageCount: 1,
      candidatePagePath: path,
      paginationLabel: "Available branch pages",
      previousPageLabel: "Previous",
      previousPageAriaLabel: "Previous page",
      nextPageLabel: "Next",
      nextPageAriaLabel: "Next page",
      unlisted: response.candidates.map((candidate) => ({
        ...candidate,
        id: String(candidate.id),
        path: resourcePath(`${base}/candidates/${candidate.id}/registration`, search),
      })),
      registered: response.registered.map((prototype) => ({
        id: String(prototype.id),
        branchName: prototype.branchName,
        name: prototype.name,
        description: prototype.description,
        startPage: prototype.startPage,
        readOnly: !prototype.canEdit,
        path: resourcePath(`${base}/prototypes/${prototype.id}/registration`, search),
      })),
    },
  }
}
