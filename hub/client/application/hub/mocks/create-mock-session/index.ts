import type { UserRecord } from "@application/hub/contracts/types"
import type { SessionResponse } from "@application/hub/session-contracts/types"

import type { MockProfile } from "../contracts/types"
import { MockStoreError } from "../store-error"

export function createMockSession(users: UserRecord[], initialLogin: string) {
  let profile: MockProfile = "owner"
  let revision = 0

  function read(): SessionResponse & { profile: MockProfile; revision: number } {
    const login = profile === "reader" ? "mona" : initialLogin
    const viewer = profile === "signed-out" ? null : users.find((user) => user.login === login)
    if (viewer === undefined) throw new Error("The selected mock user is missing from the fixture.")
    return {
      viewer: viewer ? { ...viewer } : null,
      profile,
      revision,
      capabilities: {
        createPrototypes: profile === "owner" || profile === "admin",
        reviewPrototypes: profile === "owner" || profile === "admin",
        manageSharing: profile === "owner" || profile === "admin",
        administerHub: profile === "admin",
      },
    }
  }

  return {
    read,
    select(nextProfile: MockProfile) {
      profile = nextProfile
      revision += 1
      return read()
    },
    requireViewer() {
      const viewer = read().viewer
      if (!viewer) throw new MockStoreError(401, "Sign in to continue.")
      return viewer
    },
    requireCapability(capability: keyof SessionResponse["capabilities"]) {
      const session = read()
      if (!session.viewer) throw new MockStoreError(401, "Sign in to continue.")
      if (!session.capabilities[capability]) {
        throw new MockStoreError(403, "You do not have permission to make that change.")
      }
      return session.viewer
    },
  }
}
