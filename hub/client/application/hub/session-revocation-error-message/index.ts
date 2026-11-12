const messages: Record<string, string> = {
  cancelled: "This authorization was cancelled. Start the session revocation again.",
  expired: "This authorization expired. Start the session revocation again.",
  invalid_operation:
    "This authorization no longer matches session revocation. Return to the sessions page and start again.",
  not_authorized: "Your account is no longer a Hub administrator.",
  retry_exhausted:
    "Another authentication change conflicted with this request. Review the current counts and try again.",
  session_mismatch:
    "This authorization belongs to another browser session. Start the session revocation again.",
  transaction_error: "Hub could not end the sessions. No authentication changes were saved.",
  used: "This authorization was already used. Review the current session state before trying again.",
  verification_required:
    "Provider verification is still required. Start the session revocation again.",
}

export function sessionRevocationErrorMessage(message: string) {
  return messages[message] ?? message
}
