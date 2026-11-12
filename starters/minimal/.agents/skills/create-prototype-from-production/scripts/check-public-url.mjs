import { readSync, realpathSync } from "node:fs"
import { BlockList, isIP } from "node:net"
import { pathToFileURL } from "node:url"

const supported = new BlockList()
supported.addSubnet("0.0.0.0", 0, "ipv4")
supported.addSubnet("2000::", 3, "ipv6")

const blocked = new BlockList()
for (const subnet of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "2001::/23",
  "2001:db8::/32",
  "2002::/16",
  "3fff::/20",
]) {
  const [network, prefix] = subnet.split("/")
  blocked.addSubnet(network, Number(prefix), isIP(network) === 6 ? "ipv6" : "ipv4")
}

const credentialParameters = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "apikey",
  "password",
  "passwd",
  "sessionid",
  "authorization",
  "signature",
  "sig",
  "jwt",
  "secret",
  "secretkey",
  "privatekey",
  "authtoken",
  "oauthtoken",
  "resettoken",
  "invitetoken",
  "sessiontoken",
  "apitoken",
  "accesskey",
  "jsessionid",
  "phpsessid",
  "xamzsignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "xgoogsignature",
  "xgoogcredential",
])
const jwt =
  /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/

function decodeComponent(value) {
  // Nested values may be ordinary text with literal percent signs.
  return new URLSearchParams(
    `component=${value.replaceAll("&", "%26").replaceAll("+", "%2B")}`,
  ).get("component")
}

export function checkUrlPrivacy(source) {
  const maximumNestedUrls = 64
  const pending = [source]
  const seen = new Set()
  while (pending.length > 0) {
    const url = pending.pop()
    if (seen.has(url.href)) continue
    if (seen.size >= maximumNestedUrls) return "too many nested URLs to inspect safely"
    seen.add(url.href)
    if (url.username || url.password) return "embedded URL credentials are not allowed"

    const rawFragment = url.hash.slice(1)
    const pathname = decodeComponent(url.pathname)
    const fragment = decodeComponent(rawFragment)
    const components = [pathname, fragment].flatMap((part) => part.split(/[/?&#=;]/))
    const matrixPaths = [url.pathname, pathname]
    const fragmentQueries = []
    // Keep trailing delimiters so nested credential values starting with # remain nonempty.
    const fragmentParts = [rawFragment, fragment].flatMap((part) => [
      part,
      ...part.split(/(?<=#)/).slice(1),
    ])
    for (const part of fragmentParts) {
      const route = part.replace(/^!/, "")
      const queryStart = route.indexOf("?")
      if (route.startsWith("/")) {
        const path = queryStart < 0 ? route : route.slice(0, queryStart)
        matrixPaths.push(path)
        if (/^\/[A-Za-z0-9_%.-]+=/.test(path)) fragmentQueries.push(path.slice(1))
        if (queryStart >= 0) fragmentQueries.push(route.slice(queryStart + 1))
      } else {
        fragmentQueries.push(route)
        if (queryStart >= 0) fragmentQueries.push(route.slice(queryStart + 1))
      }
    }
    const matrixParameters = matrixPaths
      .flatMap((path) => path.split("/").flatMap((segment) => segment.split(";").slice(1)))
      // Matrix fields use semicolons, so ampersands remain part of a field's value.
      .flatMap((field) => [...new URLSearchParams(field.replaceAll("&", "%26"))])
    const parameters = [
      ...url.searchParams,
      ...fragmentQueries.flatMap((query) => [...new URLSearchParams(query)]),
      ...matrixParameters,
    ]
    if (
      parameters.some(
        ([name, value]) =>
          jwt.test(name) ||
          (value.length > 0 &&
            (credentialParameters.has(name.toLowerCase().replace(/[-_]/g, "")) || jwt.test(value))),
      ) ||
      components.some((part) => jwt.test(part))
    ) {
      return "secret-bearing URL components are not allowed"
    }
    for (const [, value] of parameters) {
      let candidate = value
      for (let remaining = maximumNestedUrls; remaining > 0; remaining--) {
        // The fixed base only parses relative values; nested URLs are never requested.
        const nested = URL.parse(candidate, "https://url.invalid/")
        if (nested) {
          const nestedPath = decodeComponent(nested.pathname)
          if (
            nested.username ||
            nested.password ||
            nested.search ||
            nested.hash ||
            (nestedPath.includes(";") && (URL.canParse(candidate) || /[/\\]/.test(candidate))) ||
            jwt.test(nestedPath)
          ) {
            pending.push(nested)
            break
          }
        }
        // Preserve parsed URL boundaries; inspect their parameter values separately.
        if (URL.canParse(candidate)) break
        const decoded = decodeComponent(candidate)
        if (decoded === candidate) break
        if (remaining === 1) return "too many encoded URL layers to inspect safely"
        candidate = decoded
      }
    }
  }
}

export function checkPublicUrl(value) {
  if (typeof value !== "string" || !value.trim() || !URL.canParse(value))
    return "requires an absolute HTTP(S) URL"
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) return "requires an absolute HTTP(S) URL"
  try {
    decodeURIComponent(url.pathname)
    decodeURIComponent(url.hash.slice(1))
  } catch (error) {
    if (!(error instanceof URIError)) throw error
    return "invalid encoded URL components are not allowed"
  }
  const privacyProblem = checkUrlPrivacy(url)
  if (privacyProblem) return privacyProblem

  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase()
  const family = isIP(host)
  if (family) {
    const type = family === 6 ? "ipv6" : "ipv4"
    if (!supported.check(host, type) || blocked.check(host, type))
      return "nonpublic IP destination is not allowed"
  } else if (
    !host.includes(".") ||
    [
      "localhost",
      "local",
      "internal",
      "intranet",
      "private",
      "corp",
      "home",
      "lan",
      "home.arpa",
      "localdomain",
      "localdomain4",
      "localdomain6",
      "test",
      "invalid",
      "example",
      "alt",
      "onion",
    ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  ) {
    return "local or reserved hostname destination is not allowed"
  }
}

function readStdinUrl() {
  const maximumBytes = 64 * 1024
  const buffer = Buffer.alloc(maximumBytes + 1)
  let length = 0
  while (length < buffer.length) {
    const bytes = readSync(0, buffer, length, buffer.length - length, null)
    if (bytes === 0) break
    length += bytes
  }
  if (length > maximumBytes) throw new Error("URL stdin input exceeds 64 KiB.")
  const value = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)).trim()
  if (!value || /\s/.test(value)) throw new Error("Expected exactly one URL on stdin.")
  return value
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node check-public-url.mjs URL | --stdin")
    process.exit(2)
  }
  let value = process.argv[2]
  if (value === "--stdin") {
    try {
      value = readStdinUrl()
    } catch (error) {
      console.error(`Cannot read reference URL: ${error.message}`)
      process.exit(2)
    }
  }
  const problem = checkPublicUrl(value)
  if (problem) {
    console.error(`Cannot use reference URL: ${problem}.`)
    process.exit(1)
  }
  console.log("Passed static URL checks; no DNS lookup or network request was performed.")
}
