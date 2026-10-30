import type { UserRecord } from "../../contracts"
import type { MockCapability, MockProfile, SessionResponse } from "../../session-contracts"
import { MockStoreError } from "../store-error"

export function createMockSession(users: UserRecord[], initialLogin: string) {
  let profile: MockProfile = "owner"
  let revision = 0

  function read(): SessionResponse {
    const login = profile === "reader" ? "mona" : initialLogin
    const viewer = profile === "signed-out" ? null : users.find((user) => user.login === login)
    if (viewer === undefined) throw new Error("The selected mock user is missing from the fixture.")
    return {
      viewer: viewer ? { ...viewer } : null,
      profile,
      revision,
      capabilities: {
        createPrototypes: profile === "owner" || profile === "admin",
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
      if (!viewer) throw new MockStoreError(401, "Sign in with a mock user to continue.")
      return viewer
    },
    requireCapability(capability: MockCapability) {
      const session = read()
      if (!session.viewer) throw new MockStoreError(401, "Sign in with a mock user to continue.")
      if (!session.capabilities[capability]) {
        throw new MockStoreError(403, "This mock profile cannot make that change.")
      }
      return session.viewer
    },
  }
}

export type MockSession = ReturnType<typeof createMockSession>
