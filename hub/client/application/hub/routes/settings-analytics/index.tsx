import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("analytics", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("analytics", loaderData)
}

export default function SettingsAnalyticsRoute({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="analytics" data={loaderData} />
}
