import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("learnings", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("learnings", loaderData)
}

export default function SettingsLearningsRoute({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="learnings" data={loaderData} />
}
