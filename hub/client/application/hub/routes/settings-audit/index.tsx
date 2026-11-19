import { redirect } from "react-router"
import { z } from "zod"

import { SecurityAuditPage } from "@pages/security-audit-page"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSecurityAudits } from "@application/hub/requests/get-security-audits"
import { getWorkspace } from "@application/hub/requests/get-workspace"
import { SettingsRouteScreen } from "@application/hub/screens/settings-route-screen"
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
    (scopes[0] === "hub"
      ? repositories.length > 0
      : scopes[0] !== "repository" || repositories.length !== 1 || !repository.success)
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
  return { before, repositoryId: repository.success ? repository.data : undefined }
}

export async function clientLoader(
  args: Parameters<typeof controller.clientLoader>[0],
): Promise<SettingsRouteData | RealAuditRouteData> {
  if (isMockMode()) return controller.clientLoader(args)

  const { before, repositoryId } = readRealAuditAddress(new URL(args.request.url))
  const session = await getCurrentHubSession(args.request)
  if (!repositoryId && session.role !== "ADMINISTRATOR") {
    throw new Response("Administrator access is required.", { status: 403 })
  }
  try {
    const response = await getSecurityAudits(args.request, before, repositoryId)
    const workspace = repositoryId ? await getWorkspace(args.request) : undefined
    const repository = workspace?.repositories.find(({ id }) => id === repositoryId)
    if (repositoryId && (!workspace || !repository?.capabilities?.administerRepository)) {
      throw new Response("Repository not found.", { status: 404 })
    }
    return {
      surface: "security-audit",
      page: securityAuditPageData(
        session,
        response,
        workspace && repository ? { workspace, repository } : undefined,
      ),
    }
  } catch (error) {
    if (repositoryId || !(error instanceof ApiRequestError) || error.status !== 403) throw error
    await getCurrentHubSession(args.request)
    throw new Response("Your account no longer has Hub administrator access.", { status: 403 })
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
