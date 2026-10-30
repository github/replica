import type { NewPrototypePageData } from "@pages/new-prototype-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { ProductCatalogResponse } from "../../product-contracts"
import { productContinuation } from "../product-continuation"
import { repositoryWorkspace } from "../repository-workspace"
import { resourcePath } from "../resource-path"

export function productNewData(
  workspace: WorkspaceResponse,
  response: ProductCatalogResponse,
  search: URLSearchParams,
): NewPrototypePageData {
  const repositoryPath = `/repositories/${response.repository.id}`
  return {
    ...repositoryWorkspace(workspace, response.repository, search),
    newPrototypePath: resourcePath(`${repositoryPath}/new`, search),
    selectedSection: "new",
    repositoryName: response.repository.nameWithOwner,
    pageTitle: "Create a mock prototype",
    promptInstructions: "Create a synthetic local prototype only. Do not call GitHub or publish.",
    templatePageInstructions: "Template route: %{route}",
    templateLandingPageInstructions: "Use the template route %{route} as local metadata.",
    submissionMode: "copilot",
    templates: response.templates.map((template) => ({
      id: template.id,
      name: template.name,
      category: template.id === "default" ? "Starter" : "Repository prototype",
      description: template.description,
      route: template.route ?? "/",
      path: resourcePath(`${repositoryPath}/templates/${template.id}`, search),
      screenshotSrc: template.screenshotUrl ?? undefined,
      screenshotAlt: `${template.name} synthetic preview`,
    })),
    catalog: {
      heading: "Explore local templates",
      searchLabel: "Search templates",
      clearSearchLabel: "Clear search",
      countUnitOne: "template",
      countUnitOther: "templates",
      openTemplateLabel: "Explore template",
      previewUnavailableLabel: "Preview unavailable",
      noSearchResultsHeading: "No matching templates",
      noSearchResultsDescription: "Try a different search.",
    },
    copy: {
      ...productContinuation(),
      heading: "What should we create?",
      descriptionPlaceholder: "Describe the prototype you want to explore...",
      templateLabel: "Template",
      previewUnavailable: "Preview unavailable",
      addDetails: "Add details",
      editDetails: "Edit details",
      detailsHeading: "Add details (optional)",
      detailsDescription: "These details become local prototype metadata. No code is generated.",
      changeLabel: "What should change from today?",
      changePlaceholder: "What should become easier?",
      audienceLabel: "Who is this for?",
      audiencePlaceholder: "Who will use the prototype?",
      outcomeLabel: "What should someone be able to do?",
      outcomePlaceholder: "Describe the intended outcome.",
      closeDetails: "Close details",
      saveDetails: "Done",
      submitLabel: "Create mock prototype",
    },
  }
}
