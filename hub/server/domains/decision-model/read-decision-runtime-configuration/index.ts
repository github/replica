import { createHash } from "node:crypto"

import type { DecisionRuntimeCredentialProvider } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export function readDecisionRuntimeConfiguration(environment: NodeJS.ProcessEnv): {
  baseUrl: string
  credentialProvider: DecisionRuntimeCredentialProvider
} | null {
  const baseUrl = environment.REPLICA_DECISION_RUNTIME_URL
  const authentication = environment.REPLICA_DECISION_RUNTIME_AUTHENTICATION
  const token = environment.REPLICA_DECISION_RUNTIME_TOKEN
  const supplied = [baseUrl, authentication, token].some((value) => value !== undefined)
  if (!supplied) return null
  if (!baseUrl || authentication !== "environment-token" || !token) {
    throw new Error(
      "REPLICA_DECISION_RUNTIME_URL, REPLICA_DECISION_RUNTIME_AUTHENTICATION=environment-token, and REPLICA_DECISION_RUNTIME_TOKEN are required together.",
    )
  }
  const url = new URL(baseUrl)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("REPLICA_DECISION_RUNTIME_URL must be an HTTPS URL without credentials.")
  }
  if (token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error(
      "REPLICA_DECISION_RUNTIME_TOKEN must contain at least 32 printable ASCII characters.",
    )
  }
  const configurationDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify({ baseUrl: url.href, authentication }))
    .digest("hex")}`
  return {
    baseUrl: url.href,
    credentialProvider: {
      key: authentication,
      configurationDigest,
      getCredential({ signal }) {
        if (signal.aborted) {
          return Promise.reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("The decision runtime credential request was cancelled."),
          )
        }
        return Promise.resolve({ token, expiresAt: new Date(Date.now() + 5 * 60_000) })
      },
    },
  }
}
