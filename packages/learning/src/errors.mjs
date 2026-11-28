/**
 * Every refusal the learning layer reports. code is stable for programs; message is for people.
 *
 * Codes: invalid_input, invalid_record, scope_violation, purpose_not_granted, grant_inactive,
 * not_found, conflict, stale_review, identity_revalidation_required, invalid_transition,
 * human_required, provider_incompatible,
 * storage_corrupt, storage_outcome_unknown (a write's commit could not be confirmed, so it may
 * or may not be stored, though never in part), unsupported, unauthorized (a
 * service such as Copilot refused the credential), and unavailable (a service did not answer or
 * answered in a form the contract refuses).
 */
export class LearningError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = "LearningError"
    this.code = code
    this.details = details
  }
}

/** A provider refused an append because a record with the same key already holds other content. */
export class ProviderConflictError extends LearningError {
  constructor(message, details = {}) {
    super("conflict", message, details)
    this.name = "ProviderConflictError"
  }
}

/** Quote untrusted diagnostic text without terminal controls or invisible formatting. */
export function quoteDiagnostic(text) {
  return JSON.stringify(text).replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (character) =>
    character
      .split("")
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join(""),
  )
}
