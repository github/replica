import type { PrototypesShowPageData } from "@pages/prototypes-show-page/types"
import { reviewCommentsCopy } from "@utils/review-comment/en"

import type { PrototypeResponse, WorkspaceResponse } from "../../contracts"
import { buildStateLabel } from "../build-state-label"
import { prototypeWorkspace } from "../prototype-workspace"
import { resourcePath } from "../resource-path"

export function prototypeShowData(
  workspace: WorkspaceResponse,
  data: PrototypeResponse,
  search: URLSearchParams,
): PrototypesShowPageData {
  const selectedBuild = data.selectedBuild
  const previewBuild = selectedBuild?.previewUrl ? selectedBuild : null
  const workspaceData = prototypeWorkspace({
    workspace,
    repository: data.repository,
    prototype: data.prototype,
    selectedBuild,
    search,
    surface: "preview",
  })

  return {
    ...workspaceData,
    buildPinned: search.has("build"),
    prototypeName: data.prototype.name,
    prototypeDescription: data.prototype.description,
    showPrototypeInfo: false,
    editDetailsLabel: "Edit details",
    editDetailsHeading: "Edit prototype details",
    nameLabel: "Name",
    saveDetailsLabel: "Save details",
    cancelEditLabel: "Cancel",
    nameMaximumLength: 120,
    descriptionMaximumLength: 4000,
    descriptionLabel: "Description",
    noDescriptionLabel: "No description has been added to this prototype.",
    prototypeInfoLabel: "About this prototype",
    dismissInfoLabel: "View prototype",
    closeInfoLabel: "Close prototype information",
    branchFromHereLabel: "Branch from here",
    forkLabel: "Branch from here",
    branchFromLabel: `Branch from: ${data.prototype.name}`,
    branchPlaceholder: "What changes would you like to make?",
    branchSubmitLabel: "Start from this prototype",
    branchSubmissionMode: "disabled",
    branchInstructions: "",
    branchPageInstructions: "",
    branchContinuation: {
      continuationHeading: "Continue in Copilot app",
      continueMessage: "Creating prototypes is not connected in this local frontend.",
      installMessage: "",
      downloadLabel: "Download the app",
      downloadUrl: "https://github.com/github/app#install",
      openAppLabel: "Open Copilot app",
      closeLabel: "Close Copilot app dialog",
      copyPromptLabel: "Copy prompt",
      copiedLabel: "Copied prompt",
      copyErrorLabel: "Could not copy the prompt.",
    },
    emptyHeading: selectedBuild
      ? `Build ${selectedBuild.number} has no preview`
      : "No preview available",
    emptyLabel: selectedBuild
      ? `${buildStateLabel(selectedBuild.state)}. Build history remains available.`
      : "This prototype has no preview in the local mock data. Build history remains available.",
    previewUrlLabel: "Preview URL",
    copyPreviewUrlLabel: "Copy preview URL",
    copiedPreviewUrlLabel: "Copied preview URL",
    copyPreviewUrlErrorLabel:
      "Could not copy the preview URL. Check clipboard access and try again.",
    openInNewTabLabel: "Open in new tab",
    minimizeHubLabel: "Minimize Hub UI",
    maximizeHubLabel: "Maximize Hub UI",
    dragControlsLabel: "Move preview controls. Drag or use arrow keys.",
    minimizedPreview: false,
    pageTitle: `${data.prototype.name} · ${data.repository.nameWithOwner}`,
    prototypeId: data.prototype.id,
    repositoryId: data.repository.id,
    repositoryName: data.repository.nameWithOwner,
    reviewCommentsPath: "",
    reviewComments: {
      bodyMaximumBytes: 10_000,
      copy: reviewCommentsCopy,
    },
    latestBuild: selectedBuild && !previewBuild ? undefined : workspaceData.latestBuild,
    buildSelectionLabel:
      selectedBuild && !previewBuild
        ? `Build ${selectedBuild.number} · ${buildStateLabel(selectedBuild.state)}`
        : "Choose build",
    selectedBuild: previewBuild?.previewUrl
      ? {
          number: previewBuild.number,
          detailsLabel: "Build details",
          detailsPath: resourcePath(
            `/repositories/${data.repository.id}/prototypes/${data.prototype.id}/builds/${previewBuild.number}`,
            search,
          ),
          frameTitle: `${data.prototype.name}, Build ${previewBuild.number} preview`,
          previewUrl: previewBuild.previewUrl,
        }
      : undefined,
  }
}
