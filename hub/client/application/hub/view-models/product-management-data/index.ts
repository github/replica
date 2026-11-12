import type { PrototypeManagementPageData } from "@pages/prototype-management-page/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { ProductManagementResponse } from "@application/hub/product-contracts/types"

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
      : "You can view prototype details, but you do not have permission to change them.",
    backLabel: "Back to prototypes",
    pageTitle: "Edit prototype listings",
    sectionLoadId: path,
    repositoryChoices: {
      repositories: common.repositories,
      path,
      loadingLabel: "Loading repositories...",
      errorLabel: "Hub could not load all repository choices.",
      retryLabel: "Retry repository choices",
      failed: false,
    },
    management: {
      heading: "Edit prototype listings",
      unlistedHeading: "Available branches",
      unlistedDescription:
        "Add a branch to Hub to make your prototype available for others to explore.",
      registeredHeading: "Prototypes in Hub",
      registeredEmptyLabel:
        "No prototypes in Hub yet. Once you add a branch, it will appear here so you can manage its details.",
      emptyLabel:
        "No branches available to add. When you create a new branch, it will appear here so you can add it to Hub.",
      nameLabel: "Name",
      descriptionLabel: "Description (optional)",
      startPageLabel: "Start page (optional)",
      startPageHint:
        "Paste a preview URL or route, including any query or fragment. Leave blank to start at /.",
      addLabel: "Add to Hub",
      editLabel: "Edit details",
      saveLabel: "Save details",
      cancelLabel: "Cancel",
      addDialogHeading: "Add branch to Hub",
      editDialogHeading: "Edit prototype details",
      closeDialogLabel: "Close dialog",
      nameMaximumLength: 120,
      descriptionMaximumLength: 4000,
      candidateCheckFailed: false,
      candidateCheckFailedLabel: "Hub could not check which branches you can add.",
      candidateLoadingLabel: "Checking branches you can add...",
      candidateRetryLabel: "Retry branch check",
      candidateDataPath: path,
      candidatePage: 1,
      candidatePageCount: 1,
      candidatePagePath: path,
      paginationLabel: "Available branches pages",
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
