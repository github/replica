import type { Logger } from "pino"

import { createConfiguredArtifactStorage } from "../../artifacts/create-configured-artifact-storage/index.ts"
import { resolveLocalSignInEnvironment } from "../../authentication/resolve-local-sign-in-environment/index.ts"
import { readLearningConfiguration } from "../../learning/read-learning-configuration/index.ts"
import { createDecisionModelStore } from "../create-decision-model-store/index.ts"
import { createHubDecisionTasksetSource } from "../create-hub-decision-taskset-source/index.ts"
import { decisionTrainingJob } from "../jobs/decision-training.ts"
import { recoverDecisionTrainingJobs } from "../jobs/recover-decision-training.ts"
import { reconcileRuntimeDeletionsJob } from "../jobs/reconcile-runtime-deletions.ts"
import { readDecisionRuntimeConfiguration } from "../read-decision-runtime-configuration/index.ts"
import { createDecisionRuntimeClient } from "../../../integrations/decision-runtime/create-decision-runtime-client/index.ts"
import { createDecisionModelJobProcessors } from "../create-decision-model-job-processors/index.ts"

export function createConfiguredDecisionModelJobProcessors(
  environment: NodeJS.ProcessEnv,
  logger: Logger,
) {
  let processorsPromise: ReturnType<typeof load> | undefined

  async function load() {
    const resolvedEnvironment = resolveLocalSignInEnvironment(environment)
    const databaseUrl = resolvedEnvironment.DATABASE_URL
    const hubOrigin = resolvedEnvironment.HUB_APPLICATION_ORIGIN
    const runtimeConfiguration = readDecisionRuntimeConfiguration(resolvedEnvironment)
    if (!databaseUrl || !hubOrigin || !runtimeConfiguration) {
      throw new Error(
        "DATABASE_URL, HUB_APPLICATION_ORIGIN, and decision runtime configuration are required for decision-model jobs.",
      )
    }
    const [artifactStorage, learning] = await Promise.all([
      createConfiguredArtifactStorage(resolvedEnvironment),
      readLearningConfiguration(resolvedEnvironment),
    ])
    const { prisma } = await import("../../../integrations/prisma/index.ts")
    const source = createHubDecisionTasksetSource({
      artifactStorage,
      cliPath: learning.cliPath,
      database: prisma,
      databaseUrl,
      hubOrigin,
      learningRoot: learning.root,
      nodePath: learning.nodePath,
      staticDirectories: learning.staticDirectories,
    })
    return createDecisionModelJobProcessors({
      databaseUrl,
      database: prisma,
      logger,
      dependencies: {
        authorization: {
          requireRepositoryAdministrator: () => Promise.resolve(),
        },
        now: () => new Date(),
        prepareTaskset: (input) =>
          import("../prepare-decision-taskset/index.ts").then(({ prepareDecisionTaskset }) =>
            prepareDecisionTaskset(input, source.tasksetSource),
          ),
        preflightTaskset: (input) =>
          import("../prepare-decision-taskset/index.ts").then(({ preflightDecisionTaskset }) =>
            preflightDecisionTaskset(input, source.tasksetSource),
          ),
        hasTrainingConsent: (input) => source.tasksetSource.hasTrainingConsent(input),
        prepareBuildEvaluation: (input) => source.prepareBuildEvaluation(input),
        runtime: createDecisionRuntimeClient(runtimeConfiguration),
        store: createDecisionModelStore(prisma),
        withControlLock: (operation) => operation(new AbortController().signal),
        listTrainingWithdrawals: () => source.tasksetSource.listTrainingWithdrawals(),
      },
    })
  }

  function processors() {
    processorsPromise ??= load()
    return processorsPromise
  }

  return {
    run: {
      name: decisionTrainingJob.name,
      process: async (job: unknown) => (await processors()).run.process(job),
    },
    recover: {
      name: recoverDecisionTrainingJobs.name,
      process: async (job: unknown) => {
        if (!readDecisionRuntimeConfiguration(resolveLocalSignInEnvironment(environment))) return
        return (await processors()).recover.process(job)
      },
    },
    reconcileDeletions: {
      name: reconcileRuntimeDeletionsJob.name,
      process: async (job: unknown) => {
        if (!readDecisionRuntimeConfiguration(resolveLocalSignInEnvironment(environment))) return
        return (await processors()).reconcileDeletions.process(job)
      },
    },
  }
}
