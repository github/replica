import type { RepositoryWorkspaceData } from "@features/repository-workspace/types"
import type { CopilotAppContinuationCopy } from "@components/copilot-app-continuation/types"
import type { TemplateCatalogData } from "@features/template-catalog/types"

export interface NewPrototypePageData extends RepositoryWorkspaceData {
  repositoryName: string
  pageTitle: string
  promptInstructions: string
  templatePageInstructions: string
  templateLandingPageInstructions: string
  submissionMode: "copy" | "copilot"
  templates: TemplateCatalogData["templates"]
  catalog: Omit<TemplateCatalogData, "templates">
  copy: CopilotAppContinuationCopy & {
    heading: string
    descriptionPlaceholder: string
    templateLabel: string
    previewUnavailable: string
    addDetails: string
    editDetails: string
    detailsHeading: string
    detailsDescription: string
    changeLabel: string
    changePlaceholder: string
    audienceLabel: string
    audiencePlaceholder: string
    outcomeLabel: string
    outcomePlaceholder: string
    closeDetails: string
    saveDetails: string
    submitLabel: string
  }
}
