import { runCommand } from "../run-command/index.mjs"
import { readHubObject } from "../read-hub-object/index.mjs"
import type { CanvasContext } from "../create-canvas-context/index.mjs"

export type ReviewAuthor = {
  login: string
  name: string | null
  avatarUrl: string | null
}
export type ReviewerScope = {
  hubOrigin: string
  repository: string
  connectionId?: string
  viewerLogin: string
}
export type ReviewerProfile = ReturnType<typeof createReviewerProfile>
type Profile = { author: ReviewAuthor; error: string | null }

export function createReviewerProfile(context: Pick<CanvasContext, "repositoryPath">) {
  const profiles = new Map<string, Promise<Profile>>()

  async function load(scope: ReviewerScope): Promise<Profile> {
    const author = { login: scope.viewerLogin, name: null, avatarUrl: null }
    function unavailable(message: string) {
      return { author, error: `Profile photo unavailable: ${message}` }
    }
    const result = await runCommand(
      "gh",
      ["api", "--hostname", "github.com", "user"],
      context.repositoryPath,
    )
    if (!result.ok) return unavailable("GitHub CLI could not read the authenticated account.")

    let profile
    try {
      const parsed: unknown = JSON.parse(result.stdout)
      profile = readHubObject(parsed)
    } catch {
      return unavailable("GitHub CLI returned invalid account details.")
    }
    if (
      typeof profile?.login !== "string" ||
      !profile.login ||
      (profile.name != null && typeof profile.name !== "string") ||
      (profile.avatar_url != null && typeof profile.avatar_url !== "string")
    )
      return unavailable("GitHub CLI returned invalid account details.")
    if (profile.login.toLowerCase() !== scope.viewerLogin.toLowerCase())
      return unavailable("GitHub CLI is signed in as a different reviewer.")

    const avatar = profile.avatar_url ? URL.parse(profile.avatar_url) : null
    if (
      profile.avatar_url &&
      (!avatar ||
        avatar.protocol !== "https:" ||
        avatar.hostname !== "avatars.githubusercontent.com" ||
        avatar.port ||
        avatar.username ||
        avatar.password)
    )
      return unavailable("GitHub returned an unsupported profile photo URL.")

    return {
      author: {
        ...author,
        name: profile.name?.trim() || null,
        avatarUrl: avatar?.href || null,
      },
      error: null,
    }
  }

  return {
    async read(scope: ReviewerScope) {
      const key = JSON.stringify([
        scope.hubOrigin,
        scope.repository,
        scope.connectionId,
        scope.viewerLogin,
      ])
      let profile = profiles.get(key)
      if (!profile) {
        profile = load(scope)
        profiles.set(key, profile)
      }
      return profile
    },
  }
}
