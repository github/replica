import { useOutletContext } from "react-router"

import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
import { RealInboxScreen } from "@application/hub/screens/real-inbox-screen"
import type { WorkspaceResponse } from "@application/hub/contracts/types"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const settings = settingsController("notifications", "workspace")
function isMockMode() {
  return import.meta.env.DEV && import.meta.env.MODE === "mock"
}

export function clientLoader(args: Parameters<typeof settings.clientLoader>[0]) {
  return isMockMode() ? settings.clientLoader(args) : null
}

export function clientAction(args: Parameters<typeof settings.clientAction>[0]) {
  if (!isMockMode()) throw new Response("Method not allowed.", { status: 405 })
  return settings.clientAction(args)
}

export function meta({ loaderData }: { loaderData?: SettingsRouteData | null }) {
  return settingsMeta("notifications", loaderData ?? undefined)
}

export default function SettingsNotifications({
  loaderData,
}: {
  loaderData?: SettingsRouteData | null
}) {
  const workspace = useOutletContext<WorkspaceResponse>()
  return isMockMode() && loaderData ? (
    <SettingsRouteScreen section="notifications" data={loaderData} />
  ) : (
    <RealInboxScreen workspace={workspace} />
  )
}
