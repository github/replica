import type { Logger } from "pino"

import type { Broadcast } from "../integrations/ws/types.ts"
import type { AuthenticationRouteDependencies } from "./api/auth/types.ts"
import type { GitHubWebhookRouteDependencies } from "./api/github/webhooks/types.ts"
import type { CopilotConnectionRouteDependencies } from "./api/copilot-connection/types.ts"
import type { LearningsRouteDependencies } from "./api/learnings/types.ts"
import type { WorkspaceProductRouteDependencies } from "./api/product/types.ts"
import type { PublicSharingRouteDependencies } from "./api/public-sharing/types.ts"
import type { BuildPreviewRouteDependencies } from "./build-preview/types.ts"
import type { PrivatePreviewRouteDependencies } from "./private-preview/types.ts"
import type { GitHubSetupRouteDependencies } from "./api/settings/github/types.ts"
import type { DecisionModelRouteDependencies } from "./api/decision-model/types.ts"
import type { AgentVisualCriticRouteDependencies } from "./api/canvas/decision-model/types.ts"
import type { AgentConnectionRouteDependencies } from "./agent-connections/types.ts"

export interface RouteDependencies {
  agentConnections?: AgentConnectionRouteDependencies
  agentVisualCritic?: AgentVisualCriticRouteDependencies
  authentication?: AuthenticationRouteDependencies
  copilotConnection?: CopilotConnectionRouteDependencies
  decisionModels?: DecisionModelRouteDependencies
  learnings?: LearningsRouteDependencies
  product?: WorkspaceProductRouteDependencies
  publicSharing?: PublicSharingRouteDependencies
  preview?: BuildPreviewRouteDependencies
  privatePreview?: PrivatePreviewRouteDependencies
  githubSetup?: GitHubSetupRouteDependencies
  githubWebhooks?: GitHubWebhookRouteDependencies
  broadcast?: Broadcast
  isReady?: () => Promise<boolean>
  logger?: Logger
}
