import type { CopilotAppContinuationCopy } from "@components/copilot-app-continuation/types"

export function productContinuation(): CopilotAppContinuationCopy {
  return {
    continuationHeading: "Continue in Copilot app",
    continueMessage: "This local mock does not start a Copilot agent.",
    installMessage: "No external app is opened by the mock flow.",
    downloadLabel: "About Copilot",
    downloadUrl: "https://github.com/features/copilot",
    openAppLabel: "Open Copilot",
    closeLabel: "Close",
    copyPromptLabel: "Copy prompt",
    copiedLabel: "Copied prompt",
    copyErrorLabel: "Could not copy the prompt. Check clipboard access and try again.",
  }
}
