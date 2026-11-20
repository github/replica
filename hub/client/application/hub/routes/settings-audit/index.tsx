import { redirect } from "react-router"
import { z } from "zod"

import { SecurityAuditPage } from "@pages/security-audit-page"
import { loadAdministratorWorkspace } from "@application/hub/load-administrator-workspace"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSecurityAudits } from "@application/hub/requests/get-security-audits"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
import { hubWorkspace } from "@application/hub/view-models/hub-workspace"
import { securityAuditPageData } from "@application/hub/view-models/security-audit-page-data"

import { settingsController } from "../settings-controller"
import type { SettingsRouteData } from "../settings-controller/types"
import { settingsMeta } from "../settings-meta"

const controller = settingsController("audit", "workspace")

type RealAuditRouteData = {
  surface: "security-audit"
  page: ReturnType<typeof securityAuditPageData>
}

function isMockMode() {
  return import.meta.env.DEV && import.meta.env.MODE === "mock"
}

function readRealAuditAddress(url: URL) {
  const fields = [...url.searchParams.keys()]
  if (fields.some((field) => field !== "scope" && field !== "before" && field !== "repositoryId")) {
    throw new Response("The Hub security audit address is invalid.", { status: 400 })
  }
  const scopes = url.searchParams.getAll("scope")
  if (scopes.length === 0 && !url.searchParams.has("repositoryId")) {
    url.searchParams.set("scope", "hub")
    throw redirect(`${url.pathname}?${url.searchParams}`)
  }
  const repositories = url.searchParams.getAll("repositoryId")
  const repository = z.uuid().safeParse(repositories[0])
  if (
    scopes.length !== 1 ||
    repositories.length > 1 ||
    (repositories.length === 1 && !repository.success) ||
    (scopes[0] !== "hub" && (scopes[0] !== "repository" || !repository.success))
  ) {
    throw new Response("Select a valid security audit scope.", { status: 400 })
  }
  const cursors = url.searchParams.getAll("before")
  if (cursors.length > 1 || (cursors[0] !== undefined && !cursors[0])) {
    throw new Response("The security audit cursor is invalid.", { status: 400 })
  }
  const before = cursors[0]
  if (before && before.length > 500) {
    throw new Response("The security audit cursor is invalid.", { status: 400 })
  }
  return {
    before,
    repositoryId:
      scopes[0] === "repository" && repository.success ? repository.data.toLowerCase() : undefined,
  }
}

export async function clientLoader(
  args: Parameters<typeof controller.clientLoader>[0],
): Promise<SettingsRouteData | RealAuditRouteData> {
  if (isMockMode()) return controller.clientLoader(args)

  const { request } = args
  const url = new URL(request.url)
  const { before, repositoryId } = readRealAuditAddress(url)
  const session = await getCurrentHubSession(request)
  if (!repositoryId && session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  let response
  try {
    response = await getSecurityAudits(request, before, repositoryId)
  } catch (error) {
    if (repositoryId || !(error instanceof ApiRequestError) || error.status !== 403) throw error
    await getCurrentHubSession(request)
    throw new Response("Your account no longer has Hub administrator access.", { status: 403 })
  }
  if (!repositoryId) {
    const navigation = await loadAdministratorWorkspace(request, session, "audit")
    return { surface: "security-audit", page: securityAuditPageData(session, response, navigation) }
  }
  const workspace = await getWorkspace(request)
  const repository = workspace.repositories.find(({ id }) => id === repositoryId)
  if (workspace.viewer.id !== session.userId || !repository?.capabilities?.administerRepository) {
    throw new Response("Repository not found.", { status: 404 })
  }
  const navigation = hubWorkspace(workspace, url.searchParams, "audit")
  return {
    surface: "security-audit",
    page: securityAuditPageData(session, response, navigation, repository),
  }
}

export async function clientAction(args: Parameters<typeof controller.clientAction>[0]) {
  if (!isMockMode()) {
    throw new Response("The Hub security audit is read-only.", { status: 405 })
  }
  return controller.clientAction(args)
}

export function meta({ loaderData }: { loaderData?: SettingsRouteData | RealAuditRouteData }) {
  if (loaderData?.surface === "security-audit") {
    return [{ title: "Security audit - Replica Hub" }]
  }
  return settingsMeta("audit", loaderData)
}

export default function SettingsAudit({
  loaderData,
}: {
  loaderData: SettingsRouteData | RealAuditRouteData
}) {
  if (loaderData.surface === "security-audit") {
    return <SecurityAuditPage data={loaderData.page} />
  }
  return <SettingsRouteScreen section="audit" data={loaderData} />
}
