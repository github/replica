import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("enrollment", "public")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("enrollment", loaderData)
}

export default function SettingsEnrollmentRoute({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="enrollment" data={loaderData} />
}
