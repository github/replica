import { runCommand } from "../run-command/index.mjs"
import { readCanvasRepository } from "../read-canvas-repository/index.mjs"
import { githubLoginPattern } from "../identity-patterns/index.mjs"
import type { CanvasContext } from "../create-canvas-context/index.mjs"

export type CanvasAuthorProfile = {
  avatarUrl: string | null
  error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function readCanvasAuthorProfile(
  context: CanvasContext,
  login: unknown,
  command: typeof runCommand = runCommand,
): Promise<CanvasAuthorProfile> {
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
  let profile: unknown
  try {
    profile = JSON.parse(result.stdout)
  } catch {
    return {
      avatarUrl: null,
      error: "GitHub returned an invalid author profile.",
    }
  }
  if (!isRecord(profile))
    return {
      avatarUrl: null,
      error: "GitHub did not confirm the connected author's avatar.",
    }
  const avatarValue = profile.avatar_url
  const avatar =
    typeof avatarValue === "string" && URL.canParse(avatarValue) ? new URL(avatarValue) : null
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
