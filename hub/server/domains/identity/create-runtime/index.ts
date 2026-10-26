import { prisma } from "../../../integrations/prisma/index.ts"
import { createGitHubIdentityClient } from "../../../integrations/github/create-identity-client/index.ts"
import { createIdentityStore } from "../../../repositories/identity/create-store/index.ts"
import { createCredentialProvider } from "../create-credential-provider/index.ts"
import { createIdentityService } from "../create-service/index.ts"

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
  const provider = createCredentialProvider(environment)
  const store = createIdentityStore(prisma)
  await store.lock(async (records) => {
    const credentials = provider.read(await records.state())
    if (!credentials && !bootstrapSecret) {
      throw new Error("Set HUB_BOOTSTRAP_SECRET before starting an unconfigured Hub.")
    }
  })
  const settings = { origin: origin.origin, bootstrapSecret, secureCookies }
  const service = createIdentityService({
    store,
    provider,
    github: createGitHubIdentityClient(settings.origin),
    settings,
  })
  return { service, settings }
}
