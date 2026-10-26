import { GitHubResponseError } from "#server/integrations/github/github-response-error"

export async function requestGitHub(path: string, token: string, method = "GET"): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    })
  } catch {
    throw new GitHubResponseError(0)
  }
  if (!response.ok) throw new GitHubResponseError(response.status)
  return response.json()
}
