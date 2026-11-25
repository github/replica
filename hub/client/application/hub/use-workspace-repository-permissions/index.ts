import { useEffect, useEffectEvent, useState } from "react"
import { useRevalidator } from "react-router"

import type { RepositoryRecord, WorkspaceResponse } from "@application/hub/contracts/types"
import { ApiContractError } from "@application/hub/requests/api-contract-error"
import { ApiRequestError } from "@application/hub/requests/api-request-error"
import { getWorkspace } from "@application/hub/requests/get-workspace"

type PermissionOutcome =
  | {
      kind: "verified"
      capabilities: Pick<
        NonNullable<RepositoryRecord["capabilities"]>,
        "administerRepository" | "manageAnalytics" | "managePrototypeListings"
      >
    }
  | { kind: "unavailable" }
  | { kind: "workspace-changed" }

export function useWorkspaceRepositoryPermissions(
  workspace: WorkspaceResponse,
  requestedRepositoryId: string | null,
) {
  const { revalidate } = useRevalidator()
  const { id: viewerId, provider } = workspace.viewer
  const administerHub = workspace.capabilities?.administerHub
  const repositoryId = workspace.repositoryPermissionsAvailable
    ? (
        workspace.repositories.find(({ id }) => id === requestedRepositoryId) ??
        workspace.repositories[0]
      )?.id
    : undefined
  const scope = repositoryId
    ? JSON.stringify([viewerId, provider, administerHub, repositoryId])
    : null
  const [previousScope, setPreviousScope] = useState(scope)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    scope: string
    attempt: number
    workspace: WorkspaceResponse
    outcome: PermissionOutcome
  }>()

  if (previousScope !== scope) {
    setPreviousScope(scope)
    setResult(undefined)
  }

  const receive = useEffectEvent(
    (checkedScope: string, checkedAttempt: number, outcome: PermissionOutcome) => {
      if (checkedScope !== scope || checkedAttempt !== attempt) return
      setResult({ scope: checkedScope, attempt: checkedAttempt, workspace, outcome })
      if (outcome.kind === "workspace-changed") void revalidate()
    },
  )

  useEffect(() => {
    if (!scope || !repositoryId) return
    const controller = new AbortController()
    const request = new Request(new URL(`/repositories/${repositoryId}`, window.location.origin), {
      signal: controller.signal,
    })
    void getWorkspace(request).then(
      (verified) => {
        if (controller.signal.aborted) return
        const repository = verified.repositories.find(({ id }) => id === repositoryId)
        if (
          !repository ||
          verified.viewer.id !== viewerId ||
          verified.viewer.provider !== provider ||
          verified.capabilities?.administerHub !== administerHub
        ) {
          receive(scope, attempt, { kind: "workspace-changed" })
          return
        }
        const capabilities = repository.capabilities
        if (!capabilities || capabilities.repositoryPermissionUnavailable) {
          receive(scope, attempt, { kind: "unavailable" })
          return
        }
        receive(scope, attempt, {
          kind: "verified",
          capabilities: {
            administerRepository: capabilities.administerRepository,
            manageAnalytics: capabilities.manageAnalytics,
            managePrototypeListings: capabilities.managePrototypeListings,
          },
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        if (
          (error instanceof ApiRequestError || error instanceof ApiContractError) &&
          error.status === 401
        ) {
          receive(scope, attempt, { kind: "workspace-changed" })
        } else {
          receive(scope, attempt, { kind: "unavailable" })
        }
      },
    )
    return () => controller.abort()
  }, [administerHub, attempt, provider, repositoryId, scope, viewerId])

  const active = result?.scope === scope && result.attempt === attempt ? result : undefined
  const outcome = active?.outcome
  const checkingWorkspace = outcome?.kind === "workspace-changed" && active?.workspace === workspace
  function retry() {
    setAttempt((current) => current + 1)
  }
  if (outcome?.kind !== "verified") {
    return {
      workspace,
      checkingWorkspace,
      retry: outcome && !checkingWorkspace ? retry : undefined,
    }
  }
  return {
    workspace: {
      ...workspace,
      repositories: workspace.repositories.map((repository) =>
        repository.id === repositoryId && repository.capabilities
          ? { ...repository, capabilities: { ...repository.capabilities, ...outcome.capabilities } }
          : repository,
      ),
    },
    checkingWorkspace: false,
    retry: undefined,
  }
}
