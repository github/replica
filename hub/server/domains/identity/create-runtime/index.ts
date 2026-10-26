import { createCredentialProvider } from "#server/domains/identity/create-credential-provider"
import { createIdentityService } from "#server/domains/identity/create-service"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { createGitHubIdentityClient } from "#server/integrations/github/create-identity-client"
import { prisma } from "#server/integrations/prisma"
import type {
  RepositoryProviderName,
  SignInProviderName,
} from "#server/utils/identity-contracts/types"

function readSignInProviders(environment: NodeJS.ProcessEnv): SignInProviderName[] {
  const value = environment.HUB_SIGN_IN_PROVIDERS ?? "github"
  const providers = value
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean)
  if (
    providers.length === 0 ||
    providers.some((provider) => provider !== "github" && provider !== "oidc-demo")
  ) {
    throw new Error("HUB_SIGN_IN_PROVIDERS must contain github and/or oidc-demo.")
  }
  return [...new Set(providers)] as SignInProviderName[]
}

export async function createIdentityRuntime(environment: NodeJS.ProcessEnv) {
  const origin = new URL(environment.HUB_ORIGIN ?? "http://127.0.0.1:5173")
  const secureCookies = origin.protocol === "https:"
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== origin.href.replace(/\/$/, "") ||
    origin.username ||
    origin.password ||
    (!secureCookies &&
      (environment.NODE_ENV === "production" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
  ) {
    throw new Error(
      "Set HUB_ORIGIN to an HTTPS origin, or a loopback HTTP origin outside production.",
    )
  }
  const bootstrapSecret = environment.HUB_BOOTSTRAP_SECRET
  if (bootstrapSecret && bootstrapSecret.length < 32) {
    throw new Error("HUB_BOOTSTRAP_SECRET must contain at least 32 characters.")
  }
  const demoMode = environment.HUB_DEMO_MODE === "true"
  const signInProviders = readSignInProviders(environment)
  if (signInProviders.includes("oidc-demo") && !demoMode) {
    throw new Error("The oidc-demo sign-in provider requires HUB_DEMO_MODE=true.")
  }
  const repositoryProvider = (environment.HUB_REPOSITORY_PROVIDER ??
    "github") as RepositoryProviderName
  if (!["github", "none"].includes(repositoryProvider)) {
    throw new Error("HUB_REPOSITORY_PROVIDER must be github or none.")
  }
  const provider = createCredentialProvider(environment)
  const store = createIdentityStore(prisma)
  await store.lock(async (records) => {
    const credentials = provider.read(await records.state())
    const needsGitHub = signInProviders.includes("github") || repositoryProvider === "github"
    if (needsGitHub && provider.name === "none") {
      throw new Error("GitHub capabilities require a database or environment credential provider.")
    }
    if (needsGitHub && !credentials && !bootstrapSecret) {
      throw new Error("Set HUB_BOOTSTRAP_SECRET before starting an unconfigured Hub.")
    }
  })
  const settings = {
    origin: origin.origin,
    bootstrapSecret,
    secureCookies,
    demoMode,
    signInProviders,
    repositoryProvider,
  }
  const service = createIdentityService({
    store,
    provider,
    github: createGitHubIdentityClient(settings.origin),
    settings,
  })
  return { service, settings }
}
