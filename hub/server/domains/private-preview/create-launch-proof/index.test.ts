import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { privatePreviewAddress } from "../../../utils/private-preview-address"
import { maximumResumeTokenLength } from "../types"
import { createLaunchProof } from "."

const address = privatePreviewAddress("901", "1201")!
const otherAddress = privatePreviewAddress("901", "1202")!
const settings = {
  hubOrigin: "https://hub.example.com",
  readerOrigin: "https://preview.example.net",
  readerSecret: randomBytes(32).toString("base64url"),
}
const challenge = "a".repeat(64)
const browser = randomBytes(32).toString("base64url")

describe("createLaunchProof()", () => {
  it("rejects a token signed for another purpose, address, or reader secret", () => {
    const proof = createLaunchProof(settings)
    const buildId = randomUUID()
    const intent = proof.start(address, buildId, "b".repeat(64), new Date(Date.now() + 30_000))
    const continuation = proof.attest(intent, address, () => challenge)!
    const resume = proof.startResume(address, buildId, challenge, "/")!.token
    const marker = proof.identifyBuild(address, buildId, Date.now() + 60_000, browser)

    expect(proof.read(continuation, address)).toMatchObject({ buildId, challenge })
    expect(proof.read(intent, address)).toBeNull()
    expect(proof.read(resume, address)).toBeNull()
    expect(proof.readResume(continuation, address)).toBeNull()
    expect(proof.readResume(marker, address)).toBeNull()
    expect(proof.readBuild(resume, address, browser)).toBeNull()
    expect(proof.attest(continuation, address, () => challenge)).toBeNull()

    expect(proof.read(continuation, otherAddress)).toBeNull()
    expect(proof.readResume(resume, otherAddress)).toBeNull()
    expect(proof.readBuild(marker, otherAddress, browser)).toBeNull()

    const otherSecret = createLaunchProof({
      ...settings,
      readerSecret: randomBytes(32).toString("base64url"),
    })
    expect(otherSecret.read(continuation, address)).toBeNull()
    expect(otherSecret.readResume(resume, address)).toBeNull()
    expect(otherSecret.readBuild(marker, address, browser)).toBeNull()
  })

  it("reads a Build marker only before its deadline", () => {
    const proof = createLaunchProof(settings)
    const buildId = randomUUID()
    const deadline = Date.now() + 60_000
    const marker = proof.identifyBuild(address, buildId, deadline, browser)

    expect(proof.readBuild(marker, address, browser)).toEqual({ buildId, deadline })
    expect(proof.readBuild(marker, address, randomBytes(32).toString("base64url"))).toBeNull()
    vi.spyOn(Date, "now").mockReturnValue(deadline)
    expect(proof.readBuild(marker, address, browser)).toBeNull()
  })

  it.each([
    { reason: "traversal", page: "/../admin" },
    { reason: "a reserved reader route", page: "/__replica/exchange/901/1201" },
    { reason: "an absolute URL", page: "https://example.com/" },
    { reason: "an unnormalized path", page: "checkout" },
  ])("does not sign a renewal destination with $reason", ({ page }) => {
    expect(
      createLaunchProof(settings).startResume(address, randomUUID(), challenge, page),
    ).toBeNull()
  })

  it("does not read a renewal state beyond the size limit", () => {
    const proof = createLaunchProof(settings)
    const token = proof.startResume(address, randomUUID(), challenge, "/")!.token
    const [value, signature] = token.split(".")
    const padded = `${value}${"A".repeat(maximumResumeTokenLength)}.${signature}`

    expect(proof.readResume(token, address)).not.toBeNull()
    expect(proof.readResume(padded, address)).toBeNull()
  })
})
