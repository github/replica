import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const checker = fileURLToPath(new URL("./check-public-url.mjs", import.meta.url))

test("requires an absolute credential-free HTTP(S) reference URL", async () => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, value] of [
    ["blank input", " \t"],
    ["relative path", "/cards"],
    ["hostname without a scheme", "example.com/cards"],
    ["malformed URL", "https://[fixture-malformed-marker"],
    ["local file", "file:///fixture-file-marker"],
    ["nonnetwork action", "mailto:fixture-mail-marker@example.com"],
    ["username", "https://fixture-user-marker@example.com/cards"],
    ["password", "https://:fixture-password-marker@example.com/cards"],
  ]) {
    const problem = checkPublicUrl(value)
    assert.match(problem ?? "", /\S/, name)
    assert.doesNotMatch(problem, /fixture-[a-z-]+-marker/, name)
    assert.equal(problem.includes(value), false, name)
  }
})

test("rejects local hostname forms after case and trailing-dot normalization", async () => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, url] of [
    ["single-label host", "https://intranet/"],
    ["localhost", "http://LOCALHOST./"],
    ["localhost subdomain", "https://team.LocalHost./"],
    ["local suffix", "https://service.LOCAL./"],
    ["internal suffix", "https://service.INTERNAL./"],
    ["home.arpa suffix", "https://router.HOME.ARPA./"],
    ["conventional localhost alias", "https://localhost.localdomain/"],
    ["conventional IPv4 alias", "https://localhost4.LOCALDOMAIN4./"],
    ["conventional IPv6 alias", "https://localhost6.localdomain6/"],
  ]) {
    assert.match(checkPublicUrl(url) ?? "", /\S/, name)
  }
})

test("rejects private, shared, reserved and multicast IPv4 reference targets", async () => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, host] of [
    ["unspecified network", "0.1.2.3"],
    ["private class A", "10.20.30.40"],
    ["shared-address metadata", "100.100.100.200"],
    ["loopback network", "127.2.3.4"],
    ["link-local metadata", "169.254.169.254"],
    ["private class B", "172.16.0.1"],
    ["protocol assignments", "192.0.0.8"],
    ["documentation network 1", "192.0.2.1"],
    ["deprecated relay", "192.88.99.1"],
    ["private class C", "192.168.10.2"],
    ["benchmarking network", "198.19.0.1"],
    ["documentation network 2", "198.51.100.1"],
    ["documentation network 3", "203.0.113.1"],
    ["multicast", "224.0.0.1"],
    ["reserved network", "240.0.0.1"],
  ]) {
    assert.match(checkPublicUrl(`https://${host}/reference`) ?? "", /\S/, name)
  }
})

test("rejects alternate IPv4 spellings that normalize to loopback", async () => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, host] of [
    ["short form", "127.1"],
    ["decimal integer", "2130706433"],
    ["hexadecimal integer", "0x7f000001"],
  ]) {
    assert.match(checkPublicUrl(`http://${host}/reference`) ?? "", /\S/, name)
  }
})

test("rejects local, reserved and transition IPv6 reference targets including mapped IPv4", async () => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, host] of [
    ["unspecified", "::"],
    ["loopback", "::1"],
    ["unique-local", "fd00::1"],
    ["link-local", "fe80::1"],
    ["multicast", "ff02::1"],
    ["Teredo transition", "2001::1"],
    ["documentation network", "2001:db8::1"],
    ["6to4 transition", "2002:a00:1::"],
    ["unsupported IPv6 range 1", "4000::1"],
    ["unsupported IPv6 range 2", "8000::1"],
    ["mapped link-local metadata", "::ffff:169.254.169.254"],
    ["hexadecimal mapped loopback", "::ffff:7f00:1"],
  ]) {
    assert.match(checkPublicUrl(`https://[${host}]/reference`) ?? "", /\S/, name)
  }
})

test("accepts public names, CDN URLs and public IPs without discarding URL state or requiring DNS", async () => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, url] of [
    ["query and fragment", "https://example.com/cards?term=12&locale=pt-BR#details"],
    ["CDN asset", "https://cdn.jsdelivr.net/fixture/hero.png?width=1280#image"],
    ["HTTP with a port", "http://EXAMPLE.com:8080/cards"],
    ["dotted name without public DNS", "https://unresolved.fixture.invalid/reference"],
    ["localhost only in a public-name label", "https://localhost.example.com/reference"],
    ["local words outside the hostname", "https://example.com/localhost?filter=internal#local"],
    ["public IPv4", "https://8.8.8.8/reference"],
    ["below shared-address range", "https://100.63.255.254/reference"],
    ["above shared-address range", "https://100.128.0.1/reference"],
    ["below private class B", "https://172.15.255.254/reference"],
    ["above private class B", "https://172.32.0.1/reference"],
    ["outside private class C", "https://192.169.1.1/reference"],
    ["public IPv6", "https://[2606:4700:4700::1111]/reference?view=full#details"],
    ["public mapped IPv4", "https://[::ffff:8.8.8.8]/reference"],
  ]) {
    assert.equal(checkPublicUrl(url), undefined, name)
  }
})

test("CLI accepts one public URL while making its static-only result explicit without echoing input", () => {
  const url =
    "https://cli-host-marker.example.com/cli-path-marker?state=cli-query-marker#cli-fragment-marker"
  const result = spawnSync(process.execPath, [checker, url], {
    encoding: "utf8",
    timeout: 5000,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  const output = `${result.stdout}${result.stderr}`
  assert.match(output, /static/i)
  assert.match(output, /(?:not|no|unverified)[^\n.]*DNS|DNS[^\n.]*(?:not|unverified)/i)
  assert.match(output, /(?:not|no|unverified)[^\n.]*network|network[^\n.]*(?:not|unverified)/i)
  assert.doesNotMatch(output, /cli-(?:host|path|query|fragment)-marker/)
  assert.equal(output.includes(url), false)
})

test("CLI rejects private, credential-bearing and malformed targets without exposing supplied values", async (t) => {
  for (const [name, url] of [
    [
      "private target",
      "https://cli-host-marker.internal/cli-path-marker?state=cli-query-marker#cli-fragment-marker",
    ],
    [
      "credentials",
      "https://cli-user-marker:cli-password-marker@example.com/cli-path-marker?state=cli-query-marker#cli-fragment-marker",
    ],
    ["malformed target", "https://[cli-malformed-marker"],
  ]) {
    await t.test(name, () => {
      const result = spawnSync(process.execPath, [checker, url], {
        encoding: "utf8",
        timeout: 5000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 1, result.stderr)
      const output = `${result.stdout}${result.stderr}`
      assert.match(output, /\S/)
      assert.doesNotMatch(output, /MODULE_NOT_FOUND|node:internal\//)
      assert.doesNotMatch(output, /cli-[a-z-]+-marker/)
      assert.equal(output.includes(url), false)
    })
  }
})

test("CLI requires exactly one argument and keeps excess values out of usage diagnostics", async (t) => {
  for (const [name, args] of [
    ["missing URL", []],
    [
      "excess URL",
      [
        "https://cli-first-marker.example.com/reference",
        "https://cli-second-marker.example.com/reference",
      ],
    ],
  ]) {
    await t.test(name, () => {
      const result = spawnSync(process.execPath, [checker, ...args], {
        encoding: "utf8",
        timeout: 5000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 2, result.stderr)
      const output = `${result.stdout}${result.stderr}`
      assert.match(output, /\S/)
      assert.doesNotMatch(output, /cli-(?:first|second)-marker/)
    })
  }
})
