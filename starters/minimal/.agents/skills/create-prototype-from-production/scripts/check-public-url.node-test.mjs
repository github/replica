import assert from "node:assert/strict"
import { test } from "node:test"
import { checkPublicUrl, hasCredentials, redactUrl } from "./check-public-url.mjs"

const publicUrls = [
  "https://bucket.s3.amazonaws.com/hero.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA%2F20260101&X-Amz-Signature=abc123",
  "https://acct.blob.core.windows.net/c/hero.png?sv=2024-01-01&se=2026-01-01&sr=b&sp=r&sig=abc%3D",
  "https://d111.cloudfront.net/hero.jpg?Expires=1700000000&Signature=abc~def&Key-Pair-Id=K2ABC",
  "https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/hero.png?alt=media&token=1234-abcd",
  "https://example.com/_next/image?url=%2Fhero.png&w=1920&q=75",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
  "https://example.com/products/100%-cotton-tee",
  "https://example.com/stra%DFe#save-20%",
  "https://[2606:4700::1111]/",
]

test("rejects nonpublic destinations with exact reasons", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://127.1/",
    "http://0x7f.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "https://[4000::1]/",
  ]) {
    assert.equal(checkPublicUrl(url), "nonpublic IP destination is not allowed")
  }
  for (const url of ["http://localhost/", "http://intranet/", "https://app.internal/"]) {
    assert.equal(checkPublicUrl(url), "local or reserved hostname destination is not allowed")
  }
  assert.equal(
    checkPublicUrl("https://user:pass@example.com/"),
    "embedded URL credentials are not allowed",
  )
  for (const url of ["ftp://example.com/", "not a url", "", null, 42]) {
    assert.equal(checkPublicUrl(url), "requires an absolute HTTP(S) URL")
  }
})

test("accepts public signed assets and ordinary URL syntax", () => {
  for (const url of publicUrls) assert.equal(checkPublicUrl(url), undefined)
})

test("redacts signed assets while preserving their origin and path", () => {
  for (const value of publicUrls.slice(0, 4)) {
    const url = new URL(value)
    const redacted = redactUrl(value)
    assert.ok(redacted.startsWith(url.origin + url.pathname))
    assert.doesNotMatch(redacted, /abc123|sig=abc|Signature=abc|1234-abcd|Key-Pair-Id=K2ABC/)
  }
})

test("round-trips ordinary URLs byte-identically", () => {
  for (const url of publicUrls.slice(4, 8)) assert.equal(redactUrl(url), url)
  assert.equal(redactUrl("not a url"), "not a url")
})

test("removes userinfo and path session IDs", () => {
  const redacted = redactUrl("https://u:p@example.com/a;jsessionid=XYZ/b")
  assert.doesNotMatch(redacted, /u:p@|XYZ/)
})

test("recognizes source credentials in query, fragment and JWT values", () => {
  for (const url of [
    "https://example.com/?token=x",
    "https://example.com/#access_token=x",
    "https://example.com/#!/cb?id_token=x",
    "https://example.com/?Session-ID=x",
    "https://example.com/a?x=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln",
  ]) {
    assert.equal(hasCredentials(url), "credential-bearing URL components are not allowed")
  }
  for (const url of [
    "https://example.com/?token=",
    "https://example.com/?page=2#section",
    "https://example.com/?state=open",
    "not a url",
  ]) {
    assert.equal(hasCredentials(url), undefined)
  }
})
