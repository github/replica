import type { KeyObject } from "node:crypto"

import { readGitHubAppPrivateKey } from "../read-github-app-private-key/index.ts"
import {
  githubAppKeys,
  githubSignInKeys,
  type GitHubAppConfiguration,
  type GitHubSettingKey,
  type GitHubSettingState,
} from "./types.ts"

const digits = /^[1-9]\d{0,19}$/
const token = /^\S{1,200}$/

function validId(input: string) {
  return digits.test(input) && Number.isSafeInteger(Number(input))
}

/** Classifies GitHub settings by name; only parsed credentials carry values. */
export function readGitHubAppConfiguration(environment: NodeJS.ProcessEnv): GitHubAppConfiguration {
  function value(key: GitHubSettingKey) {
    return environment[key]?.trim() ?? ""
  }
  let privateKey: KeyObject | undefined
  const validators: Record<GitHubSettingKey, (input: string) => boolean> = {
    GITHUB_CLIENT_ID: (input) => token.test(input),
    GITHUB_CLIENT_SECRET: (input) => input.length <= 2_000 && !/\s/.test(input),
    GITHUB_PROVIDER_REVISION: validId,
    GITHUB_APP_ID: validId,
    GITHUB_APP_PRIVATE_KEY_BASE64: (input) => {
      privateKey = readGitHubAppPrivateKey(input)
      return Boolean(privateKey)
    },
    GITHUB_APP_INSTALLATION_ID: validId,
    GITHUB_WEBHOOK_SECRET: (input) => input.length >= 20 && input.length <= 2_000,
  }
  const settings = {} as Record<GitHubSettingKey, GitHubSettingState>
  for (const key of [...githubSignInKeys, ...githubAppKeys]) {
    const input = value(key)
    settings[key] = !input ? "missing" : validators[key](input) ? "present" : "invalid"
  }

  function group(keys: readonly GitHubSettingKey[]) {
    const states = keys.map((key) => settings[key])
    if (states.every((state) => state === "missing")) return "not_configured" as const
    if (states.every((state) => state === "present")) return "configured" as const
    return "incomplete" as const
  }
  const signIn = group(githubSignInKeys)
  const app = group(githubAppKeys)
  const status = group([...githubSignInKeys, ...githubAppKeys])

  return {
    status,
    signIn,
    app,
    settings,
    problems:
      status === "not_configured"
        ? []
        : (Object.entries(settings) as [GitHubSettingKey, GitHubSettingState][])
            .filter(([, state]) => state !== "present")
            .map(([key, state]) => ({ key, state: state as "missing" | "invalid" })),
    signInCredentials:
      signIn === "configured"
        ? {
            clientId: value("GITHUB_CLIENT_ID"),
            clientSecret: value("GITHUB_CLIENT_SECRET"),
            providerRevision: Number(value("GITHUB_PROVIDER_REVISION")),
          }
        : undefined,
    appCredentials:
      app === "configured" && privateKey
        ? {
            appId: value("GITHUB_APP_ID"),
            installationId: value("GITHUB_APP_INSTALLATION_ID"),
            privateKey,
            webhookSecret: value("GITHUB_WEBHOOK_SECRET"),
          }
        : undefined,
  }
}
