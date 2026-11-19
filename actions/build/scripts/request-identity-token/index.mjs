/** Requests a GitHub Actions OIDC token whose audience is the Hub's origin. */
export async function requestIdentityToken(audience, environment = process.env) {
  const url = environment.ACTIONS_ID_TOKEN_REQUEST_URL
  const token = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !token) {
    throw new Error(
      'Publishing to the Hub needs a GitHub Actions identity token. Add "permissions: id-token: write" to this job.',
    )
  }
  const requestUrl = new URL(url)
  requestUrl.searchParams.set("audience", audience)
  let response
  try {
    response = await fetch(requestUrl, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw new Error(`GitHub did not issue an identity token for the Hub: ${error.message}`, {
      cause: error,
    })
  }
  const body = response.ok ? await response.json().catch(() => null) : null
  if (typeof body?.value !== "string") {
    throw new Error(`GitHub did not issue an identity token for the Hub (HTTP ${response.status}).`)
  }
  return body.value
}
