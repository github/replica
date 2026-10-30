import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("admin-confirmation", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("admin-confirmation", loaderData)
}

export default function SettingsAdminConfirmationRoute({
  loaderData,
}: {
  loaderData: SettingsRouteData
}) {
  return <SettingsRouteScreen section="admin-confirmation" data={loaderData} />
}
