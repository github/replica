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
    ["malformed encoded path", "https://example.com/fixture-%ZZ-marker"],
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

test("rejects nonempty credential-like parameters without exposing supplied values", async (t) => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  for (const [name, suffix] of [
    ...[
      "token",
      "access_token",
      "refresh_token",
      "id_token",
      "client_secret",
      "api_key",
      "password",
      "passwd",
      "session_id",
      "authorization",
      "signature",
      "sig",
      "jwt",
      "secret",
      "secret_key",
      "private_key",
      "auth_token",
      "oauth_token",
      "reset_token",
      "invite_token",
      "session_token",
    ].map((key) => [`${key} query parameter`, `?${key}=fixture-query-marker`]),
    ["mixed-case hyphenated key", "?AcCeSs-ToKeN=fixture-query-marker"],
    ["mixed-case hyphenated private key", "?PrIvAtE-KeY=fixture-query-marker"],
    ["percent-encoded query key", "?%61pi%5Fkey=fixture-query-marker"],
    ["fragment parameter", "#access_token=fixture-fragment-marker"],
    ["question mark inside fragment value", "#access_token=fixture-fragment-marker?view=full"],
    ["encoded fragment assignment", "#access_token%3Dfixture-fragment-marker"],
    ["SPA fragment parameter", "#/callback?client%2DSeCrEt=fixture-fragment-marker"],
    [
      "encoded SPA separator and assignment",
      "#/callback%3Fclient_secret%3Dfixture-fragment-marker",
    ],
    ["nonempty repeated parameter", "?token=&token=fixture-query-marker"],
  ]) {
    await t.test(name, () => {
      const url = `https://fixture-host-marker.example.com/fixture-path-marker${suffix}`
      const problem = checkPublicUrl(url)
      assert.match(problem ?? "", /\S/)
      assert.doesNotMatch(problem, /fixture-[a-z-]+-marker/)
      assert.equal(problem.includes(url), false)
    })
  }
})

test("rejects recognizable synthetic JWT values outside credential-like parameters", async (t) => {
  const { checkPublicUrl } = await import("./check-public-url.mjs")
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c3ludGhldGlj"
  const encodedJwt = jwt.replaceAll(".", "%2E")
  for (const [name, suffix] of [
    ["unrelated query key", `/fixture-path-marker?code=${jwt}`],
    ["percent-decoded path component", `/fixture-path-marker/${encodedJwt}`],
    ["percent-decoded SPA fragment component", `/fixture-path-marker#/callback/${encodedJwt}`],
  ]) {
    await t.test(name, () => {
      const url = `https://fixture-host-marker.example.com${suffix}`
      const problem = checkPublicUrl(url)
      assert.match(problem ?? "", /\S/)
      assert.doesNotMatch(problem, /fixture-[a-z-]+-marker/)
      assert.equal(problem.includes(jwt), false)
      assert.equal(problem.includes(encodedJwt), false)
      assert.equal(problem.includes(url), false)
    })
  }
})

test("rejects local and special-use hostname suffixes after normalization", async (t) => {
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
    ["testing suffix with subdomains, case and trailing dot", "https://service.fixture.TeSt./"],
    ["invalid suffix", "https://unresolved.fixture.invalid/reference"],
    ["example suffix", "https://service.example/"],
    ["alternative naming suffix", "https://service.alt/"],
    ["onion suffix", "https://service.onion/"],
  ]) {
    await t.test(name, () => {
      assert.match(checkPublicUrl(url) ?? "", /\S/)
    })
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
    [
      "ordinary public code, state and key",
      "https://example.com/callback?code=fixture-code&state=fixture-state&key=fixture-key",
    ],
    [
      "ordinary SPA parameters",
      "https://example.com/#/callback?code=fixture-code&state=fixture-state&key=fixture-key",
    ],
    ["empty credential parameters", "https://example.com/cards?token=&password#access_token=&jwt"],
    [
      "empty SPA credential parameters",
      "https://example.com/#/callback?client_secret=&authorization",
    ],
    [
      "synthetic high-entropy cache key",
      "https://cdn.example.com/fixture/hero.png?key=p7Dq2Vx9Zm4Kc8Hr1Tf6Yw3Ls0Bn5Ga2Qi8Ue4Ro9Jv1Mz6Sd3Fp7Xk0Ch5Wt8Ay2Nl4Ej9Vu6Kb1",
    ],
    [
      "synthetic hashed CDN asset filename",
      "https://cdn.example.com/fixture/app-8c2f741de0a95b63f79a046e21d8cb55a6249d037e1b5f80c6932aab74d160ef.js",
    ],
    ["CDN asset", "https://cdn.jsdelivr.net/fixture/hero.png?width=1280#image"],
    ["HTTP with a port", "http://EXAMPLE.com:8080/cards"],
    [
      "dotted public-TLD fixture without DNS lookup",
      "https://unresolved.fixture-site.net/reference",
    ],
    ["example under the public net TLD", "https://example.net/reference"],
    ["example under the public org TLD", "https://example.org/reference"],
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

test("CLI accepts public URL arguments and literal stdin while reporting static-only checks", async (t) => {
  const url =
    "https://cli-host-marker.example.com/cli-path-marker?state=cli-query-marker&key=$fixture;literal|data#cli-fragment-marker"
  for (const [name, args, input] of [
    ["URL argument", [url], undefined],
    ["whitespace-wrapped literal stdin", ["--stdin"], ` \t${url}\r\n`],
    ["exactly 64 KiB of stdin", ["--stdin"], url.padEnd(64 * 1024, " ")],
  ]) {
    await t.test(name, () => {
      const result = spawnSync(process.execPath, [checker, ...args], {
        input,
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
  }
})

test("CLI rejects private, credential-bearing and malformed targets without exposing supplied values", async (t) => {
  for (const [name, url, stdin = false, problem = /\S/] of [
    [
      "private target",
      "https://cli-host-marker.internal/cli-path-marker?state=cli-query-marker#cli-fragment-marker",
    ],
    [
      "credentials",
      "https://cli-user-marker:cli-password-marker@example.com/cli-path-marker?state=cli-query-marker#cli-fragment-marker",
    ],
    [
      "query credentials",
      "https://cli-host-marker.example.com/cli-path-marker?access_token=cli-query-marker#cli-fragment-marker",
    ],
    ["malformed target", "https://[cli-malformed-marker"],
    [
      "private stdin target",
      "https://127.1/cli-path-marker?state=cli-query-marker#cli-fragment-marker",
      true,
      /private|local|non.?public|not public/i,
    ],
    [
      "secret stdin target",
      "https://cli-host-marker.example.com/cli-path-marker?access_token=cli-query-marker#cli-fragment-marker",
      true,
      /secret|credential/i,
    ],
  ]) {
    await t.test(name, () => {
      const result = spawnSync(process.execPath, [checker, ...(stdin ? ["--stdin"] : [url])], {
        input: stdin ? `${url}\n` : undefined,
        encoding: "utf8",
        timeout: 5000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 1, result.stderr)
      const output = `${result.stdout}${result.stderr}`
      assert.match(output, problem)
      assert.doesNotMatch(output, /MODULE_NOT_FOUND|node:internal\//)
      assert.doesNotMatch(output, /cli-[a-z-]+-marker/)
      assert.equal(output.includes(url), false)
    })
  }
})

test("CLI rejects incorrect arguments or stdin data without exposing supplied values", async (t) => {
  const url =
    "https://cli-host-marker.example.com/cli-path-marker?state=cli-query-marker#cli-fragment-marker"
  for (const [name, args, input] of [
    ["missing URL", []],
    [
      "excess URL",
      [
        "https://cli-first-marker.example.com/reference",
        "https://cli-second-marker.example.com/reference",
      ],
    ],
    ["missing stdin data", ["--stdin"], ""],
    ["blank stdin data", ["--stdin"], " \t\r\n"],
    ["extra stdin argument", ["--stdin", "https://cli-extra-marker.example.com/reference"], url],
    ["internal newline", ["--stdin"], url.replace("cli-path-marker", "cli-path-\nmarker")],
    ["internal carriage return", ["--stdin"], url.replace("cli-path-marker", "cli-path-\rmarker")],
    ["multiple URL lines", ["--stdin"], `${url}\nhttps://cli-second-marker.example.com/reference`],
    [
      "multiple URLs on one line",
      ["--stdin"],
      `${url} https://cli-second-marker.example.com/reference`,
    ],
    [
      "one UTF-8 byte over 64 KiB before trimming",
      ["--stdin"],
      `${url.padEnd(64 * 1024 - 1, " ")}\u00a0`,
    ],
  ]) {
    await t.test(name, () => {
      const result = spawnSync(process.execPath, [checker, ...args], {
        input,
        encoding: "utf8",
        timeout: 5000,
      })
      assert.equal(result.status, 2, result.stderr)
      assert.ifError(result.error)
      const output = `${result.stdout}${result.stderr}`
      assert.match(output, /\S/)
      assert.doesNotMatch(output, /cli-[a-z-]+-marker/)
    })
  }
})
