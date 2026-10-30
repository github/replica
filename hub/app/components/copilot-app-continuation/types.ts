export interface CopilotAppContinuationCopy {
  continuationHeading: string
  continueMessage: string
  installMessage: string
  downloadLabel: string
  downloadUrl: string
  openAppLabel: string
  closeLabel: string
  copyPromptLabel: string
  copiedLabel: string
  copyErrorLabel: string
}

export interface CopilotAppSubmission {
  prompt: string
  url: string
}
