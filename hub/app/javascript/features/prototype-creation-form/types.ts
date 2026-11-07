import type { StartingTemplate } from "@components/template-picker/types"

export type PrototypeCreationInput = {
  brief: string
  details: { change: string; audience: string; outcome: string }
  templateId: string
  prompt: string
}

export type PrototypeCreationData = {
  promptInstructions: string
  templatePageInstructions: string
  templateLandingPageInstructions: string
  templates: StartingTemplate[]
  copy: {
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
