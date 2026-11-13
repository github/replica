import { describe, expect, it } from "vitest"

import { createGitHubRepositoryDenialNotice } from "../create-github-repository-denial-notice"
import { encryptAuthenticationValue } from "../encrypt-authentication-value"
import { readGitHubRepositoryDenialNotice } from "."

const key = Buffer.alloc(32, 1)

describe("readGitHubRepositoryDenialNotice()", () => {
  it("reads a valid, authenticated notice", () => {
    const notice = createGitHubRepositoryDenialNotice("octocat", key)

    expect(readGitHubRepositoryDenialNotice(notice.value, key)).toEqual({ login: "octocat" })
  })

  it("rejects forged, expired, and unrelated notices", () => {
    const valid = createGitHubRepositoryDenialNotice("octocat", key)
    const expired = encryptAuthenticationValue(
      JSON.stringify({
        purpose: "github_repository_access_denial",
        login: "octocat",
        expiresAt: Date.now() - 1,
      }),
      key,
    )
    const unrelated = encryptAuthenticationValue(
      JSON.stringify({ purpose: "other", login: "octocat", expiresAt: Date.now() + 60_000 }),
      key,
    )

    expect(readGitHubRepositoryDenialNotice(`${valid.value}x`, key)).toBeNull()
    expect(readGitHubRepositoryDenialNotice(valid.value, Buffer.alloc(32, 2))).toBeNull()
    expect(readGitHubRepositoryDenialNotice(expired, key)).toBeNull()
    expect(readGitHubRepositoryDenialNotice(unrelated, key)).toBeNull()
  })
})
