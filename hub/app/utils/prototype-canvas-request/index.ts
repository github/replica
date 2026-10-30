import { copy } from "../prototype-canvas/en"

export async function request<T>(path: string, token: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Replica-Canvas-Token": token,
      ...options.headers,
    },
  })
  const result = (await response.json().catch(() => ({ error: copy.invalidResponse }))) as T & {
    error?: string
    code?: string
    authorization?: { url: string; expiresAt: string }
  }

  if (!response.ok)
    throw Object.assign(new Error(result.error || copy.requestFailed), {
      code: result.code,
      statusCode: response.status,
      authorization: result.authorization,
    })
  return result
}
