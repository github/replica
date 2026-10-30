import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("authorize", "public")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("authorize", loaderData)
}

export default function SettingsAuthorizeRoute({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="authorize" data={loaderData} />
}
