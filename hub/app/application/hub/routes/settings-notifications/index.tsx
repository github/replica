import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("notifications", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("notifications", loaderData)
}

export default function SettingsNotificationsRoute({
  loaderData,
}: {
  loaderData: SettingsRouteData
}) {
  return <SettingsRouteScreen section="notifications" data={loaderData} />
}
