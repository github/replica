import { randomBytes, timingSafeEqual } from "node:crypto"

import { digestSecret } from "../../../utils/digest-secret/index.ts"
import type {
  CredentialProvider,
  IdentityContext,
  IdentityRecords,
  IdentityService,
  IdentitySettings,
  IdentityStore,
  GitHubIdentityClient,
} from "../../../utils/identity-contracts/types.ts"
import { IdentityError } from "../../../utils/identity-error/index.ts"
import { validateGitHubCredentials } from "../../../utils/validate-github-credentials/index.ts"

export function createIdentityService({
  store,
  provider,
  github,
  settings,
  now = () => new Date(),
}: {
  store: IdentityStore
  provider: CredentialProvider
  github: GitHubIdentityClient
  settings: IdentitySettings
  now?: () => Date
}): IdentityService {
  function secretMatches(actual: string, expected: string): boolean {
    return timingSafeEqual(Buffer.from(digestSecret(actual)), Buffer.from(digestSecret(expected)))
  }

  function requireBootstrap(secret: string | undefined) {
    if (!secret || !settings.bootstrapSecret || !secretMatches(secret, settings.bootstrapSecret)) {
      throw new IdentityError(
        403,
        "bootstrap_denied",
        "The deployment bootstrap secret is required.",
      )
    }
  }

  async function configured(records = store.read) {
    const state = await records.state()
    const credentials = provider.read(state)
    if (!credentials) {
      throw new IdentityError(503, "setup_required", "Configure the GitHub App before signing in.")
    }
    return { state, credentials, revision: digestSecret(JSON.stringify(credentials)) }
  }

  async function context(token: string, records = store.read): Promise<IdentityContext> {
    const session = await records.session(digestSecret(token))
    if (!token || !session) {
      throw new IdentityError(401, "sign_in_required", "Sign in to Hub.")
    }
    return { user: session.user, session, csrfToken: digestSecret(`csrf:${token}`) }
  }

  function requireCsrf(token: string, csrfToken: string) {
    if (!secretMatches(csrfToken, digestSecret(`csrf:${token}`))) {
      throw new IdentityError(403, "csrf_failed", "Reload Hub before submitting this request.")
    }
  }

  async function administrator(token: string, csrfToken: string, records: IdentityRecords) {
    requireCsrf(token, csrfToken)
    const current = await context(token, records)
    if (!current.user.administrator) {
      throw new IdentityError(403, "administrator_required", "A Hub administrator is required.")
    }
    const { revision } = await configured(records)
    const age = current.session.freshAuthorizedAt
      ? now().getTime() - current.session.freshAuthorizedAt.getTime()
      : Infinity
    if (age < 0 || age >= 5 * 60_000 || revision !== current.session.credentialRevision) {
      throw new IdentityError(
        403,
        "fresh_authorization_required",
        "Verify the same GitHub account on this browser session before continuing.",
      )
    }
    return current
  }

  return {
    async setup(secret, input) {
      requireBootstrap(secret)
      if (!provider.encrypt) {
        throw new IdentityError(
          409,
          "credentials_read_only",
          "Configure GitHub App credentials in the selected external provider.",
        )
      }
      const encrypt = provider.encrypt
      const credentials = validateGitHubCredentials(input)
      await store.lock(async (records) => {
        if (provider.read(await records.state())) {
          throw new IdentityError(
            409,
            "already_configured",
            "Use administrator credential rotation for an existing GitHub App.",
          )
        }
        await records.saveCredentials(encrypt(credentials))
        await records.audit({ event: "credentials.setup", actorId: null, sessionId: null })
      })
    },
    async start({ purpose, token, csrfToken, bootstrapSecret }) {
      if (purpose === "enroll") requireBootstrap(bootstrapSecret)
      if (purpose === "verify") requireCsrf(token ?? "", csrfToken ?? "")
      const state = randomBytes(32).toString("base64url")
      const browserToken = randomBytes(32).toString("base64url")
      const verifier = randomBytes(32).toString("base64url")
      const url = await store.lock(async (records) => {
        const configuration = await configured(records)
        const session = purpose === "verify" ? await context(token ?? "", records) : null
        await records.createAttempt({
          stateDigest: digestSecret(state),
          browserDigest: digestSecret(browserToken),
          verifier,
          purpose,
          sessionId: session?.session.id ?? null,
          generation: configuration.state.generation,
          credentialRevision: configuration.revision,
          expiresAt: new Date(now().getTime() + 15 * 60_000),
        })
        return github.authorize(configuration.credentials, state, verifier)
      })
      return { url, browserToken }
    },
    async complete(code, state, browserToken) {
      const attempt = await store.lock((records) => records.consumeAttempt(digestSecret(state)))
      if (
        !attempt ||
        attempt.expiresAt <= now() ||
        !timingSafeEqual(
          Buffer.from(digestSecret(browserToken)),
          Buffer.from(attempt.browserDigest),
        )
      ) {
        throw new IdentityError(
          401,
          "invalid_oauth_state",
          "This GitHub sign-in expired or does not belong to this browser. Start again.",
        )
      }
      const configuration = await configured()
      if (
        attempt.credentialRevision !== configuration.revision ||
        attempt.generation !== configuration.state.generation
      ) {
        throw new IdentityError(
          401,
          "sign_in_cancelled",
          "Hub credentials or sessions changed. Start a new sign-in.",
        )
      }
      const profile = await github.identify(configuration.credentials, code, attempt.verifier)
      const verifiedAt = now()
      const existingUser = await store.read.githubUser(profile.providerId)
      const admitted =
        attempt.purpose === "sign-in" && !existingUser?.administrator
          ? await github.admitted(configuration.credentials, profile)
          : false
      return store.lock(async (records) => {
        const latest = await configured(records)
        if (
          latest.revision !== attempt.credentialRevision ||
          latest.state.generation !== attempt.generation ||
          attempt.expiresAt <= now()
        ) {
          throw new IdentityError(
            401,
            "sign_in_cancelled",
            "Hub credentials or sessions changed. Start a new sign-in.",
          )
        }
        if (attempt.purpose === "verify") {
          const session = attempt.sessionId ? await records.sessionById(attempt.sessionId) : null
          if (!session) {
            throw new IdentityError(
              401,
              "sign_in_required",
              "The initiating browser session has ended. Sign in again.",
            )
          }
          const currentUser = await records.user(session.userId)
          if (
            !currentUser ||
            currentUser.provider !== "github" ||
            currentUser.providerId !== profile.providerId
          ) {
            throw new IdentityError(
              403,
              "identity_mismatch",
              "Verify the same GitHub account that started this request.",
            )
          }
          await records.verifySession(session.id, verifiedAt, latest.revision)
          await records.audit({
            event: "session.verify",
            actorId: currentUser.id,
            sessionId: session.id,
          })
          return {}
        }
        let user = await records.saveUser(profile)
        if (attempt.purpose === "enroll") user = await records.enroll(user.id)
        if (!admitted && !user.administrator) {
          throw new IdentityError(
            403,
            "repository_access_required",
            "Access to an installed repository is required to sign in.",
          )
        }
        const token = randomBytes(32).toString("base64url")
        const session = await records.createSession({
          tokenDigest: digestSecret(token),
          userId: user.id,
          signedInAt: now(),
          freshAuthorizedAt: verifiedAt,
          credentialRevision: latest.revision,
        })
        await records.audit({
          event: attempt.purpose === "enroll" ? "operator.enroll" : "session.sign_in",
          actorId: user.id,
          sessionId: session.id,
        })
        return { token }
      })
    },
    async current(token) {
      const current = await context(token)
      await configured()
      return current
    },
    async signOut(token, csrfToken) {
      requireCsrf(token, csrfToken)
      await store.lock(async (records) => {
        const current = await context(token, records)
        await records.deleteSession(current.session.id)
        await records.audit({
          event: "session.sign_out",
          actorId: current.user.id,
          sessionId: current.session.id,
        })
      })
    },
    async permission(token, owner, repository) {
      const current = await context(token)
      const configuration = await configured()
      const permission = await github.permission(
        configuration.credentials,
        {
          providerId: current.user.providerId,
          login: current.user.login,
          name: current.user.name,
          avatarUrl: current.user.avatarUrl,
        },
        owner,
        repository,
      )
      await store.lock(async (records) => {
        await context(token, records)
        if ((await configured(records)).revision !== configuration.revision) {
          throw new IdentityError(
            503,
            "credentials_changed",
            "GitHub App credentials changed. Retry the access check.",
          )
        }
      })
      return permission
    },
    async rotate(token, csrfToken, input) {
      if (!provider.encrypt) {
        throw new IdentityError(
          409,
          "credentials_read_only",
          "Configure GitHub App credentials in the selected external provider.",
        )
      }
      const encrypt = provider.encrypt
      const credentials = validateGitHubCredentials(input)
      await store.lock(async (records) => {
        const current = await administrator(token, csrfToken, records)
        const existing = await configured(records)
        if (
          existing.credentials.appId !== credentials.appId ||
          existing.credentials.clientId !== credentials.clientId
        ) {
          throw new IdentityError(
            400,
            "different_app",
            "Credential rotation must retain the existing GitHub App and client ID.",
          )
        }
        await records.saveCredentials(encrypt(credentials))
        await records.invalidateFreshness()
        await records.advanceGeneration()
        await records.audit({
          event: "credentials.rotate",
          actorId: current.user.id,
          sessionId: current.session.id,
        })
      })
    },
    async revoke(token, csrfToken, confirmed) {
      await store.lock(async (records) => {
        const current = await administrator(token, csrfToken, records)
        if (!confirmed) {
          throw new IdentityError(
            400,
            "confirmation_required",
            "Confirm that all Hub sessions, including this session, will end.",
          )
        }
        await records.advanceGeneration()
        await records.deleteSessions()
        await records.audit({
          event: "session.revoke_all",
          actorId: current.user.id,
          sessionId: current.session.id,
        })
      })
    },
    async audits(token) {
      return store.lock(async (records) => {
        const current = await context(token, records)
        if (!current.user.administrator) {
          throw new IdentityError(403, "administrator_required", "A Hub administrator is required.")
        }
        return records.audits()
      })
    },
    async denied(token, code) {
      await store.lock(async (records) => {
        const session = token ? await records.session(digestSecret(token)) : null
        await records.audit({
          event: `identity.denied.${code}`,
          actorId: session?.userId ?? null,
          sessionId: session?.id ?? null,
        })
      })
    },
  }
}
