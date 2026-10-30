import { SettingsRouteScreen } from "../../screens/settings-route-screen"
import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("audit", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("audit", loaderData)
}

export default function SettingsAuditRoute({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="audit" data={loaderData} />
}
