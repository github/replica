import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

export const { clientLoader, clientAction } = settingsController("canvas-approval", "workspace")

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("canvas-approval", loaderData)
}

export default function SettingsCanvasApproval({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="canvas-approval" data={loaderData} />
}
