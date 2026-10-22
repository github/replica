import { runCommand } from "../run-command/index.mjs"

export function createReviewerProfile(context) {
  const profiles = new Map()

  async function load(scope) {
    const author = { login: scope.viewerLogin, name: null, avatarUrl: null }
    function unavailable(message) {
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
      profile = JSON.parse(result.stdout)
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
    async read(scope) {
      const key = JSON.stringify([
        scope.hubOrigin,
        scope.repository,
        scope.connectionId,
        scope.viewerLogin,
      ])
      if (!profiles.has(key)) profiles.set(key, load(scope))
      return profiles.get(key)
    },
  }
}
