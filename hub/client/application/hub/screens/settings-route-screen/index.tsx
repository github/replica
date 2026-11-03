import { useFetcher, useLocation, useRevalidator } from "react-router"

import type { SettingsActionResult, SettingsSection } from "../../settings-contracts"
import type { SettingsRouteData } from "../../routes/settings-controller/types"
import { SettingsFormBoundary } from "../settings-form-boundary"
import { SettingsPublicScreen } from "../settings-public-screen"
import { SettingsWorkspaceScreen } from "../settings-workspace-screen"

export function SettingsRouteScreen({
  section,
  data,
}: {
  section: SettingsSection
  data: SettingsRouteData
}) {
  const fetcher = useFetcher<SettingsActionResult>()
  const location = useLocation()
  const revalidator = useRevalidator()
  const busy = fetcher.state !== "idle" || revalidator.state !== "idle"
  const result = fetcher.data
  const error = !busy && result?.saved === false && "error" in result ? result.error : null
  const notice = !busy && result?.saved === true ? result.notice : null

  function submit(input: FormData) {
    if (busy) return
    const action = input.get("_action")
    const pathname =
      typeof action === "string" ? new URL(action, window.location.href).pathname : ""
    if (pathname === "/session") {
      void fetcher.submit({ intent: "sign-out" }, { method: "post", action: "/session" })
      return
    }
    void fetcher.submit(input, {
      method: "post",
      action: `${location.pathname}${location.search}`,
    })
  }

  return (
    <SettingsFormBoundary busy={busy} error={error} notice={notice} onSubmit={submit}>
      {data.surface === "public" ? (
        <SettingsPublicScreen
          section={section}
          state={data.state}
          search={new URLSearchParams(location.search)}
        />
      ) : (
        <SettingsWorkspaceScreen section={section} data={data} busy={busy} />
      )}
    </SettingsFormBoundary>
  )
}
