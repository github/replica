import type {
  AnalyticsActor,
  AnalyticsMutation,
  createAnalyticsDestinationService,
} from "../../../../domains/analytics/create-destination-service/index.ts"
import type { CurrentSessionDependencies } from "../../auth/types.ts"
import type { createHostedAnalyticsAuthorization } from "../../../../domains/analytics/hosted-authorization/index.ts"

export type AnalyticsViewer = NonNullable<
  Awaited<ReturnType<CurrentSessionDependencies["restore"]>>
>

export interface AnalyticsRouteDependencies {
  applicationOrigin: string
  localAdministration: boolean
  hostedAuthorization?: ReturnType<typeof createHostedAnalyticsAuthorization>
  isLocalAdministrator(viewer: AnalyticsViewer, repositoryId: string): Promise<boolean>
  list: ReturnType<typeof createAnalyticsDestinationService>["list"]
  mutate(
    actor: AnalyticsActor,
    mutation: AnalyticsMutation,
    sessionDigest: string,
  ): Promise<{ id: string }>
}
