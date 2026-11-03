import type { TemplateCardData } from "@components/template-card/types"

export interface TemplateCatalogData {
  heading: string
  searchLabel: string
  clearSearchLabel: string
  countUnitOne: string
  countUnitOther: string
  openTemplateLabel: string
  previewUnavailableLabel: string
  noAdditionalTemplatesLabel?: string
  noSearchResultsHeading: string
  noSearchResultsDescription: string
  templates: TemplateCardData[]
}
