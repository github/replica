import { useEffect, useState } from "react"

import type { RepositoryRecord, WorkspaceResponse } from "@application/hub/contracts/types"
import { reportClientIssue } from "@application/hub/report-client-issue"
import { getWorkspace } from "@application/hub/requests/get-workspace"

export function useWorkspaceRepositoryPermissions(
  workspace: WorkspaceResponse | null,
  requestedRepositoryId: string | null,
) {
  const repositoryId = workspace?.repositoryPermissionsAvailable
    ? (
        workspace.repositories.find(({ id }) => id === requestedRepositoryId) ??
        workspace.repositories[0]
      )?.id
    : undefined
  const [result, setResult] = useState<{
    workspace: WorkspaceResponse
    repositoryId: string
    capabilities: Partial<NonNullable<RepositoryRecord["capabilities"]>>
  }>()

  useEffect(() => {
    if (!workspace || !repositoryId) return
    const controller = new AbortController()
    const request = new Request(new URL(`/repositories/${repositoryId}`, window.location.origin), {
      signal: controller.signal,
    })
    void getWorkspace(request)
      .then((verified) => {
        if (
          controller.signal.aborted ||
          verified.viewer.id !== workspace.viewer.id ||
          verified.viewer.provider !== workspace.viewer.provider ||
          verified.capabilities?.administerHub !== workspace.capabilities?.administerHub
        ) {
          return
        }
        const capabilities = verified.repositories.find(
          ({ id }) => id === repositoryId,
        )?.capabilities
        if (!capabilities) return
        setResult({
          workspace,
          repositoryId,
          capabilities: {
            administerRepository: capabilities.administerRepository,
            manageAnalytics: capabilities.manageAnalytics,
            managePrototypeListings: capabilities.managePrototypeListings,
            repositoryPermissionUnavailable: capabilities.repositoryPermissionUnavailable,
          },
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          reportClientIssue("Repository management permissions could not be refreshed.")
        }
      })
    return () => controller.abort()
  }, [repositoryId, workspace])

  if (
    !workspace ||
    !result ||
    result.workspace !== workspace ||
    result.repositoryId !== repositoryId
  )
    return workspace

  return {
    ...workspace,
    repositories: workspace.repositories.map((repository) =>
      repository.id === repositoryId && repository.capabilities
        ? { ...repository, capabilities: { ...repository.capabilities, ...result.capabilities } }
        : repository,
    ),
  }
}
