const messages: Record<string, string> = {
  cancelled: "This authorization was cancelled. Start the administrator change again.",
  expired: "This authorization expired. Start the administrator change again.",
  identity_mismatch:
    "The provider verified a different account. Return to the roster and try again with the same account.",
  invalid_operation:
    "This authorization no longer matches the administrator change. Return to the roster and start again.",
  invalid_selection: "Choose between one and 50 distinct Hub users.",
  invalid_target:
    "One or more selected Hub users are no longer available. Review the current roster and try again.",
  last_administrator:
    "The final Hub administrator cannot be removed. Designate another existing Hub user first.",
  not_authorized: "Your account is no longer a Hub administrator.",
  retry_exhausted:
    "Another administrator change conflicted with this one. Review the current roster and try again.",
  role_changed:
    "An administrator role changed before this request completed. Review the current roster and try again.",
  session_mismatch:
    "This authorization belongs to another browser session. Start the administrator change again.",
  transaction_error: "Hub could not complete the administrator change. Try again.",
  used: "This authorization was already used. Review the current roster, then start again.",
  verification_required:
    "Provider verification is still required. Start the administrator change again.",
}

export function administratorErrorMessage(message: string) {
  return messages[message] ?? message
}
