import type { CurrentSessionDependencies } from "../auth/types.ts"
import type { DecisionModelSettings } from "../../../domains/decision-model/types.ts"

export interface DecisionModelRouteDependencies {
  applicationOrigin: string
  currentSession: CurrentSessionDependencies
  getOverview(input: { repositoryId: string; actorMembershipId: string }): Promise<unknown>
  saveSettings(input: {
    repositoryId: string
    actorMembershipId: string
    settings: DecisionModelSettings
  }): Promise<unknown>
  requestTraining(input: {
    repositoryId: string
    actorMembershipId: string
    idempotencyKey: string
  }): Promise<unknown>
  getTrainingJob(input: {
    repositoryId: string
    actorMembershipId: string
    jobId: string
  }): Promise<unknown>
  cancelTraining(input: {
    repositoryId: string
    actorMembershipId: string
    jobId: string
  }): Promise<unknown>
  promote(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    candidateId: string
    expectedGeneration: number
  }): Promise<unknown>
  rollback(input: {
    repositoryId: string
    actorMembershipId: string
    actorLogin: string
    expectedGeneration: number
  }): Promise<unknown>
  evaluateBuild(input: {
    repositoryId: string
    actorMembershipId: string
    buildId: string
  }): Promise<unknown>
}
