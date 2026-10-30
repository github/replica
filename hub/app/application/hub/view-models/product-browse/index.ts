import type { ReplicaBrowsePageData } from "@pages/replica-browse-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { ProductTemplateResponse } from "../../product-contracts"
import { productContinuation } from "../product-continuation"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

export function productBrowseData(
  workspace: WorkspaceResponse,
  response: ProductTemplateResponse,
  search: URLSearchParams,
): ReplicaBrowsePageData {
  const { repository, template } = response
  const base = `/repositories/${repository.id}`
  return {
    ...repositoryWorkspace(workspace, repository, search),
    newPrototypePath: response.canCreate ? resourcePath(`${base}/new`, search) : null,
    browseReplica: true,
    templateId: template.id,
    pageTitle: `${template.name} template`,
    repositoryName: repository.nameWithOwner,
    branchName: repository.defaultBranch,
    branchPath: resourcePath(`${base}/templates/${template.id}`, search),
    prototypeName: template.name,
    closeLabel: "Return to templates",
    closePath: resourcePath(`${base}/new`, search),
    repositoryPath: resourcePath(base, search),
    useDarkThemeLabel: "Use dark theme",
    useLightThemeLabel: "Use light theme",
    previewUrlLabel: "Synthetic preview address",
    copyPreviewUrlLabel: "Copy preview address",
    copiedPreviewUrlLabel: "Copied preview address",
    copyPreviewUrlErrorLabel: "Could not copy the address.",
    minimizeHubLabel: "Minimize Hub",
    maximizeHubLabel: "Restore Hub",
    dragControlsLabel: "Move preview toolbar",
    minimizedPreview: false,
    forkLabel: "Create from this template",
    branchFromLabel: `From ${template.name}`,
    branchPlaceholder: "Describe your changes to this template...",
    branchSubmitLabel: "Create mock prototype",
    branchSubmissionMode: "copilot",
    branchInstructions: "Create a local synthetic prototype only.",
    branchPageInstructions: "Template route: %{route}",
    branchContinuation: productContinuation(),
    emptyHeading: "Template preview unavailable",
    emptyLabel: "Return to the template catalog and choose another template.",
    selectedBuild: {
      number: template.buildNumber ?? 1,
      previewUrl: template.previewUrl,
      frameTitle: `${template.name} synthetic template preview`,
    },
  }
}
