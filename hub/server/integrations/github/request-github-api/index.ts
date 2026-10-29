import { GitHubApiError } from "#server/integrations/github/github-api-error"

export async function requestGitHubApi(
  path: string,
  token: string,
  method = "GET",
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
      redirect: "error",
    })
  } catch {
    throw new GitHubApiError(0)
  }
  if (!response.ok) throw new GitHubApiError(response.status)
  if (response.status === 204) return null
  return response.json()
}
