import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { createGitHubAuthenticationContext } from "../../domains/authentication/create-github-authentication-context/index.ts"

export async function reconcileGitHubInstallation(): Promise<void> {
  const configuration = readGitHubAppConfiguration(process.env)
  if (configuration.app === "not_configured") return
  const credentials = configuration.appCredentials
  if (!credentials) throw new Error("GitHub App installation settings are incomplete or invalid.")
  if (!configuration.signInCredentials) throw new Error("GitHub sign-in is not configured.")
  const context = createGitHubAuthenticationContext(process.env)

  const [{ syncGitHubInstallationRepositories }, { listInstallationRepositories }, { prisma }] =
    await Promise.all([
      import("../../domains/admission/sync-github-installation-repositories/index.ts"),
      import("../../integrations/github/list-installation-repositories/index.ts"),
      import("../../integrations/prisma/index.ts"),
    ])
  await syncGitHubInstallationRepositories(
    prisma,
    () => listInstallationRepositories(credentials),
    { configurationDigest: context.configurationDigest, revision: context.providerRevision },
  )
}
