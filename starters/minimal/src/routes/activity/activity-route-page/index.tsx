import { ActivityPage } from "../activity-page"
import { activityRoute } from "../route"

export function ActivityRoutePage() {
  return <ActivityPage data={activityRoute.useLoaderData()} />
}
