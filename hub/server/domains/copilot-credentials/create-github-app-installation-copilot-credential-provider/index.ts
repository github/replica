import { createHash } from "node:crypto"
import { z } from "zod"

import { createGitHubAppJwtSigner } from "../../../integrations/github/create-github-app-jwt-signer/index.ts"
import { createInstallationAccessToken } from "../../../integrations/github/create-installation-access-token/index.ts"
import type { GitHubAppJwtSigner } from "../../../integrations/github/create-github-app-jwt-signer/types.ts"
import type { CopilotCredentialProvider } from "../types.ts"

const identityConfigurationSchema = z
  .object({
    GITHUB_APP_ID: z.string().regex(/^[1-9]\d*$/),
    REPLICA_COPILOT_GITHUB_INSTALLATION_ID: z.string().regex(/^[1-9]\d*$/),
    REPLICA_COPILOT_GITHUB_ORGANIZATION: z
      .string()
      .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  })
  .strict()

export function createGitHubAppInstallationCopilotCredentialProvider(
  environment: NodeJS.ProcessEnv,
  signer?: GitHubAppJwtSigner,
): CopilotCredentialProvider {
  const parsedConfiguration = identityConfigurationSchema.safeParse({
    GITHUB_APP_ID: environment.GITHUB_APP_ID?.trim(),
    REPLICA_COPILOT_GITHUB_INSTALLATION_ID:
      environment.REPLICA_COPILOT_GITHUB_INSTALLATION_ID?.trim(),
    REPLICA_COPILOT_GITHUB_ORGANIZATION: environment.REPLICA_COPILOT_GITHUB_ORGANIZATION?.trim(),
  })
  if (!parsedConfiguration.success) {
    const names = [
      ...new Set(
        parsedConfiguration.error.issues
          .map((issue) => issue.path[0])
          .filter((name): name is string => typeof name === "string"),
      ),
    ].join(", ")
    throw new Error(
      `${names || "GitHub App installation configuration"} must provide positive numeric App and installation IDs and a valid organization login.`,
    )
  }
  const configuration = parsedConfiguration.data
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n").trim()
  let jwtSigner: GitHubAppJwtSigner
  if (signer) {
    jwtSigner = signer
  } else {
    if (!privateKey) {
      throw new Error(
        "GITHUB_APP_PRIVATE_KEY is required and must contain a PEM-encoded GitHub App private key.",
      )
    }
    try {
      jwtSigner = createGitHubAppJwtSigner(privateKey)
    } catch (error) {
      throw new Error(
        "GITHUB_APP_PRIVATE_KEY must contain a valid PEM-encoded GitHub App private key.",
        { cause: error },
      )
    }
  }
  const identity = {
    appId: configuration.GITHUB_APP_ID,
    installationId: configuration.REPLICA_COPILOT_GITHUB_INSTALLATION_ID,
    organization: configuration.REPLICA_COPILOT_GITHUB_ORGANIZATION.toLowerCase(),
  }
  const configurationDigest = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        appId: identity.appId,
        installationId: identity.installationId,
        organization: identity.organization,
      }),
    )
    .digest("hex")
  const mintToken = createInstallationAccessToken({
    appId: identity.appId,
    installationId: identity.installationId,
    organization: identity.organization,
    signer: jwtSigner,
  })

  return {
    key: "github_app_installation",
    configurationDigest,
    githubAppInstallation: identity,
    async getCredential() {
      const credential = await mintToken()
      return { expiresAt: credential.expiresAt, githubToken: credential.token }
    },
  }
}
