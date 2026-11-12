import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import type { RepositoryInboxData } from "@utils/notification/types"

export function useWorkspaceInbox<
  T extends {
    workspace?: RepositoryInboxData | null
    administrationWorkspace?: RepositoryInboxData | null
    authenticatedWorkspace?: RepositoryInboxData | null
  },
>(data: T): T {
  const workspace = data.workspace ?? data.administrationWorkspace ?? data.authenticatedWorkspace
  const inbox = useRepositoryInbox(workspace ?? { authenticityToken: "" })
  if (!workspace) return data

  if (data.workspace) return { ...data, workspace: inbox }
  if (data.administrationWorkspace) return { ...data, administrationWorkspace: inbox }

  return { ...data, authenticatedWorkspace: inbox }
}
