import type { AdmissionPolicy } from "#server/domains/authentication/create-service/types"
import { createGitHubIntegrationCredentialProvider } from "#server/domains/github-integration/create-credential-provider"
import type { IdentityStore } from "#server/domains/identity/create-store/types"
import { checkRepositoryAdmission } from "#server/integrations/github/check-repository-admission"
import { AuthenticationError } from "#server/utils/authentication-error"

export function createAdmissionPolicy(
  environment: NodeJS.ProcessEnv,
  store: IdentityStore,
): AdmissionPolicy {
  const selected = environment.HUB_ADMISSION_POLICY ?? "hub-managed"
  if (selected === "hub-managed") {
    return { name: "hub-managed", admit: () => Promise.resolve(false) }
  }
  if (selected !== "legacy-repository") {
    throw new Error("HUB_ADMISSION_POLICY must be hub-managed or legacy-repository.")
  }
  const provider = createGitHubIntegrationCredentialProvider(environment)
  return {
    name: "legacy-repository",
    admit: async (profile) => {
      try {
        const credentials = provider.read(await store.read.githubIntegrationCredentials())
        if (!credentials) {
          throw new AuthenticationError(
            503,
            "source_integration_unconfigured",
            "GitHub source integration is not configured.",
          )
        }
        return await checkRepositoryAdmission(credentials, profile)
      } catch (error) {
        if (error instanceof AuthenticationError) throw error
        throw new AuthenticationError(
          503,
          "source_integration_unavailable",
          "GitHub source integration is unavailable.",
        )
      }
    },
  }
}
