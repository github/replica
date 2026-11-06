import type {
  BuildRecord,
  PrototypeRecord,
  PrototypeResponse,
  RepositoryRecord,
  UserRecord,
} from "@application/hub/contracts/types"

import type { MockSession } from "../create-session/types"

export interface MockFlowContext {
  origin: string
  session: MockSession
  resources: {
    users: UserRecord[]
    repositories: RepositoryRecord[]
    prototypes: Omit<PrototypeRecord, "builds" | "canEdit">[]
    builds: BuildRecord[]
  }
  controlsIdentity: (context: (string | number)[]) => string
  repositoryRecord: (repositoryId: number) => RepositoryRecord
  prototypeResponse: (
    repositoryId: number,
    prototypeId: number,
    buildNumber?: number,
  ) => PrototypeResponse
}
