import "dotenv/config"

import { createConfiguredArtifactStorage } from "./domains/artifacts/create-configured-artifact-storage/index.ts"
import { canViewPrivatePreview } from "./domains/private-preview/can-view-private-preview/index.ts"
import {
  PrivatePreviewConfigurationError,
  readPrivatePreviewSettings,
} from "./domains/private-preview/read-settings/index.ts"
import { PrivatePreviewWriterConfigurationError } from "./domains/private-preview/read-writer-settings/index.ts"
import { LocalSignInConfigurationError } from "./domains/authentication/errors.ts"
import { readLearningConfiguration } from "./domains/learning/read-learning-configuration/index.ts"
import { readDecisionRuntimeConfiguration } from "./domains/decision-model/read-decision-runtime-configuration/index.ts"
import { LearningConfigurationError } from "./domains/learning/errors.ts"
import { PublicSharingConfigurationError } from "./domains/public-sharing/errors.ts"
import {
  LocalDevelopmentConfigurationError,
  LocalDevelopmentPreparationError,
} from "./domains/local-development/errors.ts"
import { prepareLocalDevelopment } from "./domains/local-development/prepare-local-development/index.ts"
import { readLocalDevelopmentConfiguration } from "./domains/local-development/read-local-development-configuration/index.ts"
import { readAuthenticationConfigurationState } from "./domains/authentication/read-authentication-configuration-state/index.ts"
import { createGitHubAuthenticationContext } from "./domains/authentication/create-github-authentication-context/index.ts"
import { createSharedAuthenticationContext } from "./domains/authentication/create-shared-authentication-context/index.ts"
import { readGitHubAppConfiguration } from "./domains/authentication/read-github-app-configuration/index.ts"
import { createReviewDirectory } from "./integrations/github/create-review-directory/index.ts"
import { resolveLocalSignInEnvironment } from "./domains/authentication/resolve-local-sign-in-environment/index.ts"
import { startTelemetry } from "./integrations/opentelemetry/start-telemetry/index.ts"
import { createDecisionRuntimeClient } from "./integrations/decision-runtime/create-decision-runtime-client/index.ts"
import { logger } from "./integrations/pino/index.ts"
import { isMissingDatabaseSchema } from "./integrations/prisma/is-missing-database-schema/index.ts"
import { runApi } from "./run-api/index.ts"
import { setup } from "./scripts/setup/index.ts"
import { startServerProcesses } from "./start-server-processes/index.ts"
import { parseRuntimeConfig } from "./utils/parse-runtime-config/index.ts"
import { getJobProcessors } from "./workers/configuration.ts"
import { runJobWorker } from "./workers/run-job-worker/index.ts"
import type { AuthenticationRouteDependencies } from "./routes/api/auth/types.ts"
import type { AgentVisualCriticRouteDependencies } from "./routes/api/canvas/decision-model/types.ts"
import type { CopilotConnectionRouteDependencies } from "./routes/api/copilot-connection/types.ts"
import type { DecisionModelRouteDependencies } from "./routes/api/decision-model/types.ts"
import type { GitHubWebhookRouteDependencies } from "./routes/api/github/webhooks/types.ts"
import type { LearningsRouteDependencies } from "./routes/api/learnings/types.ts"
import type { ProductRouteDependencies } from "./routes/api/product/types.ts"
import type { PublicSharingRouteDependencies } from "./routes/api/public-sharing/types.ts"
import type { GitHubSetupRouteDependencies } from "./routes/api/settings/github/types.ts"
import type { BuildPreviewRouteDependencies } from "./routes/build-preview/types.ts"
import type { PrivatePreviewRouteDependencies } from "./routes/private-preview/types.ts"

class AuthenticationConfigurationError extends Error {}

try {
  const configuration = parseRuntimeConfig(process.env)
  const localDevelopment = readLocalDevelopmentConfiguration(process.env)
  await prepareLocalDevelopment(localDevelopment)
  let learningConfiguration: Awaited<ReturnType<typeof readLearningConfiguration>> | undefined
  let decisionRuntimeConfiguration: ReturnType<typeof readDecisionRuntimeConfiguration> = null
  if (configuration.mode !== "setup") {
    learningConfiguration = await readLearningConfiguration(process.env)
    decisionRuntimeConfiguration = readDecisionRuntimeConfiguration(process.env)
  }
  const storage =
    configuration.mode !== "setup" && configuration.hasArtifactStorage
      ? await createConfiguredArtifactStorage(process.env)
      : undefined
  const isStorageReady = storage ? () => storage.isReady() : undefined
  const telemetry = startTelemetry(process.env, logger)
  try {
    const runsApi = configuration.mode === "api" || configuration.mode === "combined"
    const configuredTrustedProxyHops = Number(process.env.HUB_TRUSTED_PROXY_HOPS ?? 0)
    if (
      runsApi &&
      (!Number.isInteger(configuredTrustedProxyHops) ||
        configuredTrustedProxyHops < 0 ||
        configuredTrustedProxyHops > 10)
    ) {
      throw new AuthenticationConfigurationError(
        "HUB_TRUSTED_PROXY_HOPS must be an integer between 0 and 10.",
      )
    }
    const trustedProxyHops = runsApi ? configuredTrustedProxyHops : 0
    let authentication: AuthenticationRouteDependencies | undefined
    let agentVisualCritic: AgentVisualCriticRouteDependencies | undefined
    let copilotConnection: CopilotConnectionRouteDependencies | undefined
    let decisionModels: DecisionModelRouteDependencies | undefined
    let learnings: LearningsRouteDependencies | undefined
    let product: ProductRouteDependencies | undefined
    let preview: BuildPreviewRouteDependencies | undefined
    let privatePreview: PrivatePreviewRouteDependencies | undefined
    let publicSharing: PublicSharingRouteDependencies | undefined
    let githubSetup: GitHubSetupRouteDependencies | undefined
    let githubWebhooks: GitHubWebhookRouteDependencies | undefined
    if (runsApi) {
      const authenticationEnvironment = resolveLocalSignInEnvironment(process.env)
      const authenticationConfiguration =
        readAuthenticationConfigurationState(authenticationEnvironment)
      const privatePreviewSettings = readPrivatePreviewSettings(authenticationEnvironment)
      if (privatePreviewSettings && trustedProxyHops === 0) {
        throw new PrivatePreviewConfigurationError(
          "Private preview requires HUB_TRUSTED_PROXY_HOPS between 1 and 10.",
        )
      }
      if (
        privatePreviewSettings &&
        (!storage ||
          !configuration.databaseUrl ||
          (!authenticationConfiguration.githubConfigured &&
            !authenticationConfiguration.localConfigured))
      ) {
        throw new AuthenticationConfigurationError(
          "Private preview requires GitHub sign-in or configured local administrator sign-in, a database, and artifact storage.",
        )
      }
      if (authenticationConfiguration.githubStatus === "incomplete") {
        if (authenticationConfiguration.githubProblems.every(({ state }) => state === "invalid")) {
          const names = authenticationConfiguration.githubProblems.map(({ key }) => key).join(", ")
          throw new AuthenticationConfigurationError(
            `GitHub App configuration is invalid. Check: ${names}.`,
          )
        }
        logger.warn(
          { settings: authenticationConfiguration.githubProblems },
          "GitHub sign-in is disabled until setup is complete at /settings/github/setup",
        )
      }
      if (
        (authenticationConfiguration.providerConfigured ||
          authenticationConfiguration.githubSettingsPresent ||
          authenticationConfiguration.sharedConfigured) &&
        !authenticationConfiguration.applicationOrigin
      ) {
        throw new AuthenticationConfigurationError(
          "HUB_APPLICATION_ORIGIN is required when authentication settings are configured.",
        )
      }
      if (
        (authenticationConfiguration.providerConfigured ||
          authenticationConfiguration.sharedConfigured ||
          authenticationConfiguration.applicationOrigin) &&
        !configuration.databaseUrl
      ) {
        throw new AuthenticationConfigurationError(
          "DATABASE_URL is required when authentication settings are configured.",
        )
      }
      if (authenticationConfiguration.applicationOrigin) {
        let sharedContext: ReturnType<typeof createSharedAuthenticationContext>
        try {
          sharedContext = createSharedAuthenticationContext(authenticationEnvironment)
        } catch (error) {
          throw new AuthenticationConfigurationError(
            "HUB_APPLICATION_ORIGIN, HUB_AUTHENTICATION_ENCRYPTION_KEY, and HUB_BOOTSTRAP_SECRET must be valid before setup. See the authentication guide.",
            { cause: error },
          )
        }
        if (
          authenticationConfiguration.providerConfigured &&
          sharedContext.secureCookie &&
          trustedProxyHops === 0
        ) {
          throw new AuthenticationConfigurationError(
            "HTTPS authentication requires HUB_TRUSTED_PROXY_HOPS between 1 and 10.",
          )
        }
      }
      if (configuration.databaseUrl) {
        const databaseUrl = configuration.databaseUrl
        const { createAuthenticationRouteDependencies, disableAuthenticationProviders } =
          await import("./routes/api/auth/create-authentication-route-dependencies/index.ts")
        try {
          if (authenticationConfiguration.providerConfigured) {
            authentication = await createAuthenticationRouteDependencies(authenticationEnvironment)
            const previewConfigured = storage && authenticationEnvironment.HUB_PREVIEW_ORIGIN
            if (previewConfigured) {
              const { createBuildPreviewRouteDependencies } =
                await import("./routes/build-preview/create-build-preview-route-dependencies/index.ts")
              preview = createBuildPreviewRouteDependencies(authenticationEnvironment, storage)
              preview.restoreSession = authentication.currentSession.restore.bind(
                authentication.currentSession,
              )
            }
            const { createCopilotConnectionRouteDependencies } =
              await import("./routes/api/copilot-connection/create-copilot-connection-route-dependencies/index.ts")
            copilotConnection = await createCopilotConnectionRouteDependencies(
              authenticationEnvironment,
              logger,
              authentication.administrators,
            )
            const { createLearningsRouteDependencies } =
              await import("./routes/api/learnings/create-learnings-route-dependencies/index.ts")
            const learningDependencies = await createLearningsRouteDependencies(
              authenticationEnvironment,
              authentication.currentSession,
              logger,
              { scopeGitHubMembers: authenticationConfiguration.githubConfigured },
            )
            learnings = learningDependencies
            if (decisionRuntimeConfiguration) {
              const applicationOrigin = authenticationEnvironment.HUB_APPLICATION_ORIGIN
              if (!storage || !learningConfiguration || !applicationOrigin) {
                throw new Error(
                  "Application origin, artifact storage, and learning storage are required when the decision runtime is configured.",
                )
              }
              const { createHubDecisionTasksetSource } =
                await import("./domains/decision-model/create-hub-decision-taskset-source/index.ts")
              const { createDecisionModelRouteDependencies } =
                await import("./routes/api/decision-model/create-decision-model-route-dependencies/index.ts")
              const source = createHubDecisionTasksetSource({
                artifactStorage: storage,
                cliPath: learningConfiguration.cliPath,
                database: (await import("./integrations/prisma/index.ts")).prisma,
                databaseUrl,
                hubOrigin: applicationOrigin,
                learningRoot: learningConfiguration.root,
                nodePath: learningConfiguration.nodePath,
                staticDirectories: learningConfiguration.staticDirectories,
                logger,
              })
              decisionModels = createDecisionModelRouteDependencies({
                applicationOrigin,
                runtimeForRepository: () =>
                  createDecisionRuntimeClient(decisionRuntimeConfiguration),
                currentSession: authentication.currentSession,
                databaseUrl,
                logger,
                tasksetSource: source.tasksetSource,
                prepareBuildEvaluation: (input) => source.prepareBuildEvaluation(input),
              })
              const { createAgentVisualCriticRouteDependencies } =
                await import("./routes/api/canvas/decision-model/create-agent-visual-critic-route-dependencies/index.ts")
              agentVisualCritic = createAgentVisualCriticRouteDependencies({
                database: (await import("./integrations/prisma/index.ts")).prisma,
                readLearningAuthority: (input) => source.readAgentLearningAuthority(input),
                runtimeForRepository: () =>
                  createDecisionRuntimeClient(decisionRuntimeConfiguration),
                runtimeEnvironment: decisionRuntimeConfiguration.environment,
              })
            }
            const { createProductRouteDependencies } =
              await import("./routes/api/product/create-product-route-dependencies/index.ts")
            const { readAnalyticsSettings } =
              await import("./domains/analytics/read-settings/index.ts")
            const localAnalyticsAdministration = Boolean(
              authentication.local &&
              authenticationEnvironment.NODE_ENV === "development" &&
              authenticationEnvironment.HUB_LOCAL_MODE === "true",
            )
            const repositoryCredentials = authentication.github
              ? readGitHubAppConfiguration(authenticationEnvironment).appCredentials
              : undefined
            product = createProductRouteDependencies({
              analyticsSettings: readAnalyticsSettings(
                authenticationEnvironment,
                localAnalyticsAdministration,
              ),
              localAnalyticsAdministration,
              applicationOrigin: authenticationEnvironment.HUB_APPLICATION_ORIGIN,
              artifactStorage: storage,
              scopeGitHubMembers: authenticationConfiguration.githubConfigured,
              githubRepositoryCredentials: repositoryCredentials,
              githubReviewDirectory: repositoryCredentials
                ? createReviewDirectory(repositoryCredentials)
                : undefined,
              onReviewCommentDeleted: (input) => learningDependencies.redactComment(input),
              previewBaseOrigin: previewConfigured
                ? authenticationEnvironment.HUB_PREVIEW_ORIGIN
                : undefined,
              privatePreviewHubOrigin: privatePreviewSettings?.hubOrigin,
              privatePreviewInline: privatePreviewSettings?.inline,
              privatePreviewLocalSignIn: authenticationConfiguration.localConfigured,
              withReviewCommentDeleteLock: (operation) =>
                learningDependencies.serializeReviewCommentDeletion(operation),
            })
            if (privatePreviewSettings && storage) {
              const { createPrivatePreviewAuthority } =
                await import("./domains/private-preview/create-authority/index.ts")
              const { createPrivatePreviewAccessStore } =
                await import("./repositories/private-previews/create-private-preview-access-store/index.ts")
              const { findPrivatePreviewTarget } =
                await import("./repositories/private-previews/find-private-preview-target/index.ts")
              const { findPrivatePreviewDistFile } =
                await import("./repositories/private-previews/find-private-preview-dist-file/index.ts")
              const { prisma } = await import("./integrations/prisma/index.ts")
              const { sessionLifetime } = await import("./domains/private-preview/types.ts")
              const restoreSession = authentication.currentSession.restore.bind(
                authentication.currentSession,
              )
              privatePreview = {
                settings: privatePreviewSettings,
                hasCurrentHubSession: async (digest) => Boolean(await restoreSession(digest)),
                authority: createPrivatePreviewAuthority({
                  readerOrigin: privatePreviewSettings.readerOrigin,
                  storage,
                  access: createPrivatePreviewAccessStore(prisma, sessionLifetime),
                  restoreSession,
                  isRepositoryVisible: product.isRepositoryVisible.bind(product),
                  hasCurrentRepositoryAccess: async (viewer, repositoryId, githubRepositoryId) => {
                    if (!canViewPrivatePreview(viewer, authenticationConfiguration.localConfigured))
                      return false
                    if (viewer.sessionProvider === "local") return true
                    const permission = await product?.getVerifiedRepositoryPermission?.(
                      viewer,
                      repositoryId,
                      githubRepositoryId,
                    )
                    return Boolean(permission && permission !== "none")
                  },
                  findTarget: (address) => findPrivatePreviewTarget(prisma, address),
                  findDistFile: (buildId, path) =>
                    findPrivatePreviewDistFile(prisma, buildId, path),
                }),
              }
            }
          } else {
            await disableAuthenticationProviders()
          }
          if (preview || !authenticationConfiguration.localConfigured) {
            const { createPublicSharingRouteDependencies } =
              await import("./routes/api/public-sharing/create-public-sharing-route-dependencies/index.ts")
            publicSharing = await createPublicSharingRouteDependencies(
              authenticationEnvironment,
              authenticationConfiguration.localConfigured
                ? undefined
                : {
                    hostedReady: Boolean(
                      preview &&
                      authentication?.github &&
                      typeof product?.getVerifiedRepositoryPermission === "function",
                    ),
                  },
            )
            if (preview && publicSharing) {
              preview.readAvailableShareLink = publicSharing.readAvailableLink.bind(publicSharing)
            }
          }
          // Local sign-in refuses GitHub settings, so GitHub setup would be a dead end there.
          if (
            authenticationConfiguration.applicationOrigin &&
            !authenticationConfiguration.localConfigured
          ) {
            const { createGitHubSetupRouteDependencies } =
              await import("./routes/api/settings/github/create-github-setup-route-dependencies/index.ts")
            const setup = createGitHubSetupRouteDependencies(authenticationEnvironment)
            githubSetup = setup
            const { appCredentials } = readGitHubAppConfiguration(authenticationEnvironment)
            if (appCredentials && authenticationConfiguration.githubConfigured) {
              const context = createGitHubAuthenticationContext(authenticationEnvironment)
              const { createGitHubWebhookRouteDependencies } =
                await import("./routes/api/github/webhooks/create-github-webhook-route-dependencies/index.ts")
              githubWebhooks = createGitHubWebhookRouteDependencies({
                installationId: appCredentials.installationId,
                provider: {
                  configurationDigest: context.configurationDigest,
                  revision: context.providerRevision,
                },
                syncRepositories: () => setup.syncRepositories(),
                webhookSecret: appCredentials.webhookSecret,
                enqueueWorkflowRunImport: async (job, deliveryId) => {
                  const { enqueueGitHubWorkflowRunImport } =
                    await import("./domains/github-builds/enqueue-github-workflow-run-import/index.ts")
                  await enqueueGitHubWorkflowRunImport(
                    { databaseUrl: configuration.databaseUrl ?? "", logger },
                    job,
                    deliveryId,
                  )
                },
              })
            }
          }
        } catch (error) {
          if (isMissingDatabaseSchema(error)) {
            throw new AuthenticationConfigurationError(
              "Hub database setup is required before API startup. Run npm run setup.",
            )
          }
          throw error
        }
      }
    }
    if (configuration.mode === "setup") await setup()
    else if (configuration.mode === "api")
      await runApi({
        ...configuration,
        logger,
        agentVisualCritic,
        isReady: isStorageReady,
        authentication,
        githubSetup,
        githubWebhooks,
        copilotConnection,
        decisionModels,
        learnings,
        product,
        preview,
        privatePreview,
        publicSharing,
        trustedProxyHops,
      })
    else {
      const databaseUrl = configuration.databaseUrl
      if (!databaseUrl) throw new Error("This runtime mode requires DATABASE_URL.")
      if (configuration.mode === "combined") {
        await startServerProcesses({
          ...configuration,
          databaseUrl,
          logger,
          agentVisualCritic,
          isStorageReady,
          authentication,
          githubSetup,
          githubWebhooks,
          copilotConnection,
          decisionModels,
          learnings,
          product,
          preview,
          privatePreview,
          publicSharing,
          trustedProxyHops,
        })
      } else {
        const name = configuration.mode
        await runJobWorker({
          name,
          databaseUrl,
          concurrency:
            name === "on-demand"
              ? configuration.onDemandConcurrency
              : configuration.scheduledConcurrency,
          shutdownTimeoutMs: configuration.shutdownTimeoutMs,
          logger,
          processors: getJobProcessors(name),
        })
      }
    }
  } finally {
    await telemetry.shutdown()
  }
} catch (error) {
  logger.fatal(
    error instanceof AuthenticationConfigurationError ||
      error instanceof PrivatePreviewConfigurationError ||
      error instanceof PrivatePreviewWriterConfigurationError ||
      error instanceof PublicSharingConfigurationError ||
      error instanceof LocalSignInConfigurationError ||
      error instanceof LocalDevelopmentConfigurationError ||
      error instanceof LocalDevelopmentPreparationError
      ? error.message
      : error instanceof LearningConfigurationError
        ? error.message
        : "Hub failed; check runtime configuration, dependencies, telemetry, and shutdown time.",
  )
  process.exit(1)
}
