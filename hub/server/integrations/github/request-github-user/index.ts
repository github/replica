import { GitHubProviderRequestError } from "../errors.ts"

export async function requestGitHubUser(
  request: typeof globalThis.fetch,
  url: string,
  accessToken: string,
): Promise<Response> {
  try {
    return await request(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: ["Bearer", accessToken].join(" "),
        "x-github-api-version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new GitHubProviderRequestError({ cause: error })
  }
}
