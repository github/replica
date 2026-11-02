import { createCipheriv } from "node:crypto"

import { describe, expect, it } from "vitest"

import { encryptAuthenticationValue } from "../encrypt-authentication-value"
import { decryptAuthenticationValue } from "."

const invalidCiphertextMessage = "Authentication ciphertext is invalid."

function createCiphertext(
  plaintext: string,
  key: Buffer,
  initializationVector: Buffer = Buffer.alloc(12, 0xff),
) {
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])

  return [
    "v1",
    initializationVector.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

function replaceSegment(value: string, index: number, replacement: string) {
  const segments = value.split(".")
  segments[index] = replacement
  return segments.join(".")
}

function expectInvalidCiphertext(operation: () => unknown, exposedValues: string[] = []) {
  let thrown: unknown

  try {
    operation()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(Error)
  const error = thrown as Error & { cause?: unknown }
  expect(error.message).toBe(invalidCiphertextMessage)
  expect(error.cause).toBeUndefined()

  for (const exposedValue of exposedValues) {
    if (!exposedValue) continue
    expect(error.message).not.toContain(exposedValue)
  }
}

describe("decryptAuthenticationValue()", () => {
  it("decrypts a value produced by the real encryptor", () => {
    const key = Buffer.alloc(32, 1)
    const encrypted = encryptAuthenticationValue("secret-value", key)

    expect(decryptAuthenticationValue(encrypted, key)).toBe("secret-value")
  })

  it.each([4, 8, 12, 15, 0, 17])("rejects a %i-byte authentication tag", (tagLength) => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted = encryptAuthenticationValue(plaintext, key)
    const encodedTag = encrypted.split(".")[2]
    if (!encodedTag) throw new Error("Expected an authentication tag.")
    const tag = Buffer.from(encodedTag, "base64url").subarray(0, tagLength)
    const replacement =
      tagLength === 17
        ? Buffer.concat([Buffer.from(encodedTag, "base64url"), Buffer.alloc(1)]).toString(
            "base64url",
          )
        : tag.toString("base64url")
    const malformed = replaceSegment(encrypted, 2, replacement)

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(malformed, key),
      [plaintext, key.toString("hex"), replacement],
    )
  })

  it("rejects an incorrect 16-byte authentication tag", () => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted = encryptAuthenticationValue(plaintext, key)
    const encodedTag = encrypted.split(".")[2]
    if (!encodedTag) throw new Error("Expected an authentication tag.")
    const tag = Buffer.from(encodedTag, "base64url")
    tag[0] = tag[0]! ^ 1
    const replacement = tag.toString("base64url")

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(replaceSegment(encrypted, 2, replacement), key),
      [plaintext, key.toString("hex"), replacement],
    )
  })

  it("rejects deterministically tampered ciphertext", () => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted = encryptAuthenticationValue(plaintext, key)
    const encodedCiphertext = encrypted.split(".")[3]
    if (!encodedCiphertext) throw new Error("Expected ciphertext.")
    const ciphertext = Buffer.from(encodedCiphertext, "base64url")
    ciphertext[0] = ciphertext[0]! ^ 1
    const replacement = ciphertext.toString("base64url")

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(replaceSegment(encrypted, 3, replacement), key),
      [plaintext, key.toString("hex"), replacement],
    )
  })

  it.each([0, 11, 13])("rejects a %i-byte initialization vector", (ivLength) => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted =
      ivLength === 0
        ? replaceSegment(createCiphertext(plaintext, key), 1, "")
        : createCiphertext(plaintext, key, Buffer.alloc(ivLength, 0xff))
    const encodedInitializationVector = encrypted.split(".")[1] ?? ""

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(encrypted, key),
      [plaintext, key.toString("hex"), encodedInitializationVector],
    )
  })

  it.each([
    ["padded initialization vector", 1, (segment: string) => `${segment}=`],
    ["padded authentication tag", 2, (segment: string) => `${segment}=`],
    ["padded ciphertext", 3, (segment: string) => `${segment}=`],
    ["permissively decoded initialization vector", 1, (segment: string) => `${segment}!`],
    ["permissively decoded authentication tag", 2, (segment: string) => `${segment}!`],
    ["permissively decoded ciphertext", 3, (segment: string) => `${segment}!`],
  ])("rejects a %s", (_description, segmentIndex, mutate) => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted = createCiphertext(plaintext, key)
    const segment = encrypted.split(".")[segmentIndex]
    if (!segment) throw new Error("Expected an encoded binary segment.")
    const replacement = mutate(segment)

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(replaceSegment(encrypted, segmentIndex, replacement), key),
      [plaintext, key.toString("hex"), replacement],
    )
  })

  it("rejects a base64url spelling that does not re-encode canonically", () => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted = createCiphertext(plaintext, key)
    const encodedTag = encrypted.split(".")[2]
    if (!encodedTag) throw new Error("Expected an authentication tag.")
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    const finalCharacterIndex = alphabet.indexOf(encodedTag.at(-1)!)
    const noncanonicalTag = `${encodedTag.slice(0, -1)}${alphabet[finalCharacterIndex + 1]}`

    expect(Buffer.from(noncanonicalTag, "base64url")).toEqual(Buffer.from(encodedTag, "base64url"))
    expect(noncanonicalTag).not.toBe(
      Buffer.from(noncanonicalTag, "base64url").toString("base64url"),
    )
    expectInvalidCiphertext(
      () => decryptAuthenticationValue(replaceSegment(encrypted, 2, noncanonicalTag), key),
      [plaintext, key.toString("hex"), noncanonicalTag],
    )
  })

  it.each([
    ["empty ciphertext", (encrypted: string) => replaceSegment(encrypted, 3, "")],
    [
      "257-byte ciphertext",
      (_encrypted: string, key: Buffer) => createCiphertext("x".repeat(257), key),
    ],
    ["wrong version", (encrypted: string) => encrypted.replace(/^v1/, "v2")],
    ["too few segments", (encrypted: string) => encrypted.split(".").slice(0, 3).join(".")],
    ["too many segments", (encrypted: string) => `${encrypted}.extra`],
  ])("rejects %s", (_description, mutate) => {
    const key = Buffer.alloc(32, 1)
    const plaintext = "secret-value"
    const encrypted = encryptAuthenticationValue(plaintext, key)
    const malformed = mutate(encrypted, key)

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(malformed, key),
      [plaintext, key.toString("hex")],
    )
  })

  it("rejects a different 32-byte key", () => {
    const key = Buffer.alloc(32, 1)
    const wrongKey = Buffer.alloc(32, 2)
    const plaintext = "secret-value"
    const encrypted = encryptAuthenticationValue(plaintext, key)
    const encodedTag = encrypted.split(".")[2]
    if (!encodedTag) throw new Error("Expected an authentication tag.")

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(encrypted, wrongKey),
      [plaintext, wrongKey.toString("hex"), encodedTag],
    )
  })

  it("rejects a key that is not 32 bytes with the generic error", () => {
    const key = Buffer.alloc(32, 1)
    const invalidKey = Buffer.alloc(31, 2)
    const plaintext = "secret-value"
    const encrypted = encryptAuthenticationValue(plaintext, key)

    expectInvalidCiphertext(
      () => decryptAuthenticationValue(encrypted, invalidKey),
      [plaintext, invalidKey.toString("hex")],
    )
  })
})
