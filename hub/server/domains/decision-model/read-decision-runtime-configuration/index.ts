import { createHash } from "node:crypto"

import type { DecisionRuntimeCredentialProvider } from "../../../integrations/decision-runtime/create-decision-runtime-client/types.ts"

export function readDecisionRuntimeConfiguration(environment: NodeJS.ProcessEnv): {
  allowInsecureLoopback: boolean
  baseUrl: string
  credentialProvider: DecisionRuntimeCredentialProvider
  environment: "fixture" | "production"
} | null {
  const baseUrl = environment.REPLICA_DECISION_RUNTIME_URL
  const authentication = environment.REPLICA_DECISION_RUNTIME_AUTHENTICATION
  const token = environment.REPLICA_DECISION_RUNTIME_TOKEN
  const runtimeEnvironment = environment.REPLICA_DECISION_RUNTIME_ENVIRONMENT
  const supplied = [baseUrl, authentication, token, runtimeEnvironment].some(
    (value) => value !== undefined,
  )
  if (!supplied) return null
  if (
    !baseUrl ||
    authentication !== "environment-token" ||
    !token ||
    (runtimeEnvironment !== "fixture" && runtimeEnvironment !== "production")
  ) {
    throw new Error(
      "REPLICA_DECISION_RUNTIME_URL, REPLICA_DECISION_RUNTIME_AUTHENTICATION=environment-token, REPLICA_DECISION_RUNTIME_TOKEN, and REPLICA_DECISION_RUNTIME_ENVIRONMENT=fixture|production are required together.",
    )
  }
  const url = new URL(baseUrl)
  const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"])
  const insecureLoopback =
    environment.NODE_ENV === "development" &&
    environment.REPLICA_DECISION_RUNTIME_ALLOW_INSECURE_LOOPBACK === "true" &&
    url.protocol === "http:" &&
    loopbackHosts.has(url.hostname)
  if (
    (url.protocol !== "https:" && !insecureLoopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "REPLICA_DECISION_RUNTIME_URL must be an HTTPS URL without credentials, or an explicitly allowed HTTP loopback URL in development.",
    )
  }
  if (token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error(
      "REPLICA_DECISION_RUNTIME_TOKEN must contain at least 32 printable ASCII characters.",
    )
  }
  const configurationDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify({ baseUrl: url.href, authentication, environment: runtimeEnvironment }))
    .digest("hex")}`
  return {
    allowInsecureLoopback: insecureLoopback,
    baseUrl: url.href,
    environment: runtimeEnvironment,
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
