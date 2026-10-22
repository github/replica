import { runCommand } from "../run-command/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import { githubLoginPattern } from "../identity-patterns/index.mjs"

export async function readCanvasAuthorProfile(context, login, command = runCommand) {
  const repository = await readCanvasRepository(context)
  if (!repository.githubRepository || typeof login !== "string" || !githubLoginPattern.test(login))
    return {
      avatarUrl: null,
      error: "The connected author's GitHub profile is unavailable.",
    }
  const result = await command(
    "gh",
    ["api", "--hostname", "github.com", `users/${encodeURIComponent(login)}`],
    context.repositoryPath,
  )
  if (!result.ok)
    return {
      avatarUrl: null,
      error: "The connected author's GitHub avatar could not be loaded.",
    }
  let profile
  try {
    profile = JSON.parse(result.stdout)
  } catch {
    return {
      avatarUrl: null,
      error: "GitHub returned an invalid author profile.",
    }
  }
  const avatar = URL.canParse(profile?.avatar_url) ? new URL(profile.avatar_url) : null
  if (
    typeof profile?.login !== "string" ||
    profile.login.toLowerCase() !== login.toLowerCase() ||
    !avatar ||
    avatar.protocol !== "https:" ||
    avatar.hostname !== "avatars.githubusercontent.com" ||
    avatar.username ||
    avatar.password ||
    avatar.port ||
    avatar.href.length > 2048
  )
    return {
      avatarUrl: null,
      error: "GitHub did not confirm the connected author's avatar.",
    }
  return { avatarUrl: avatar.href, error: null }
}
