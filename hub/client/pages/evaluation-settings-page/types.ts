export interface EvaluationSettingsPageData {
  repositoryName: string
  learningsPath: string
  budget: {
    /** Decimal credit strings, kept exact for the form and shown as numbers. */
    limitCredits: string
    usedCredits: string
    editable: boolean
  }
  evaluations: {
    editable: boolean
    enabled: boolean
    screenshotsAllowed: boolean
    /** Who last changed screenshot permission and when, if anyone has. */
    screenshotsRecord: string | null
  }
}

export interface EvaluationSettingsChange {
  enabled?: boolean
  screenshots?: boolean
}
