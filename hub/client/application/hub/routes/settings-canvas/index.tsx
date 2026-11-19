import { redirect } from "react-router"

import { canvasConnectionsPath } from "@application/hub/canvas-connections/contract"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const mock = settingsController("canvas", "workspace")

export async function clientLoader(args: Parameters<typeof mock.clientLoader>[0]) {
  if (import.meta.env.DEV && import.meta.env.MODE === "mock") return mock.clientLoader(args)
  throw redirect(canvasConnectionsPath)
}

export async function clientAction(args: Parameters<typeof mock.clientAction>[0]) {
  if (import.meta.env.DEV && import.meta.env.MODE === "mock") return mock.clientAction(args)
  throw new Response("Use Canvas connections to revoke a connection.", { status: 405 })
}

export function meta({ loaderData }: { loaderData?: SettingsRouteData }) {
  return settingsMeta("canvas", loaderData)
}

export default function SettingsCanvas({ loaderData }: { loaderData: SettingsRouteData }) {
  return <SettingsRouteScreen section="canvas" data={loaderData} />
}
