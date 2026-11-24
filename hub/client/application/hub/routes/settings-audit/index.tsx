import { redirect, useOutletContext } from "react-router"
import type { ClientLoaderFunctionArgs } from "react-router"
import { z } from "zod"

import { SecurityAuditPage } from "@pages/security-audit-page"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getCurrentHubSession } from "@application/hub/requests/get-current-hub-session"
import { getSecurityAudits } from "@application/hub/requests/get-security-audits"
import { useAdministrationNavigation } from "@application/hub/use-administration-navigation"
import { securityAuditPageData } from "@application/hub/view-models/security-audit-page-data"

import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "audit",
  independentOfRepositoryNavigation: true,
} satisfies WorkspaceRouteHandle

type AuditRouteData = {
  surface: "security-audit"
  session: CurrentHubSession
  response: Awaited<ReturnType<typeof getSecurityAudits>>
  repositoryId?: string
}

function readAuditAddress(url: URL) {
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

export async function clientLoader({
  request,
}: Pick<ClientLoaderFunctionArgs, "request">): Promise<AuditRouteData> {
  const url = new URL(request.url)
  const { before, repositoryId } = readAuditAddress(url)
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
  return { surface: "security-audit", session, response, repositoryId }
}

export function clientAction(): never {
  throw new Response("The Hub security audit is read-only.", { status: 405 })
}

export function meta() {
  return [{ title: "Security audit - Replica Hub" }]
}

export default function SettingsAudit({ loaderData: data }: { loaderData: AuditRouteData }) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const navigation = useAdministrationNavigation("audit", data.session.userId)
  const selected = workspace.repositories.find(
    ({ id }) => id === navigation.repository?.selectedRepositoryId,
  )
  const repository = data.repositoryId
    ? {
        id: data.repositoryId,
        nameWithOwner: workspace.repositories.find(({ id }) => id === data.repositoryId)
          ?.nameWithOwner,
      }
    : undefined
  return (
    <SecurityAuditPage
      data={securityAuditPageData(data.session, data.response, navigation, {
        repository,
        availableRepository:
          repository ?? (selected?.capabilities?.administerRepository ? selected : undefined),
      })}
    />
  )
}
