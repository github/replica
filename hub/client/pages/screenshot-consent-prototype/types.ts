export interface ScreenshotConsentPrototypeData {
  repositoryName: string
  personName: string
  consentRecordedAt: string
  evaluatorName: string
  consentEvaluatorName: string | null
  evaluationAvailable: boolean
  consent: boolean | null
}
