import { BlockList, isIP } from "node:net"

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

const CREDENTIAL_KEYS = new Set(
  "token accesstoken refreshtoken idtoken authtoken apitoken sessiontoken resettoken invitetoken password passwd secret clientsecret apikey sessionid sid jsessionid phpsessid authorization jwt".split(
    " ",
  ),
)
const SIGNING_KEYS = new Set(
  "sig signature keypairid policy se sp sv sr skoid sktid expires".split(" "),
)
const jwt =
  /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/
const normalize = (name) => name.toLowerCase().replace(/[-_]/g, "")
const credential = ([name, value]) =>
  (value.length > 0 && CREDENTIAL_KEYS.has(normalize(name))) || jwt.test(value)
const fragmentParams = (url) =>
  new URLSearchParams(
    url.hash
      .slice(1)
      .replace(/^!/, "")
      .replace(/^[^?]*\?/, ""),
  )

function safeDecode(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function hasCredentials(value) {
  const url = URL.parse(value)
  if (
    url &&
    ([...url.searchParams, ...fragmentParams(url)].some(credential) ||
      jwt.test(safeDecode(url.pathname)))
  )
    return "credential-bearing URL components are not allowed"
}

export function redactUrl(value) {
  const url = URL.parse(value)
  if (!url) return value
  const original = url.href
  url.username = url.password = ""
  const params = url.searchParams
  let changed = false
  for (const [name, content] of params) {
    const key = normalize(name)
    if (
      CREDENTIAL_KEYS.has(key) ||
      SIGNING_KEYS.has(key) ||
      /^(xamz|xgoog)/.test(key) ||
      jwt.test(content)
    ) {
      params.set(name, "REDACTED")
      changed = true
    }
  }
  if (changed) url.search = params.toString()
  const replaceJwt = (part) =>
    part.replace(new RegExp(jwt, "g"), (match) => match.replace(/eyJ.*/, "REDACTED"))
  url.pathname = replaceJwt(url.pathname.replace(/;(jsessionid|phpsessid)=[^/?#]*/gi, ""))
  url.hash = [...fragmentParams(url)].some(credential) ? "" : replaceJwt(url.hash)
  return url.href === original ? value : url.href
}

export function isPublicAddress(address) {
  const type = isIP(address) === 6 ? "ipv6" : "ipv4"
  return supported.check(address, type) && !blocked.check(address, type)
}

export function checkPublicUrl(value) {
  const url = typeof value === "string" && value.trim() ? URL.parse(value) : null
  if (!url || !["http:", "https:"].includes(url.protocol)) return "requires an absolute HTTP(S) URL"
  if (url.username || url.password) return "embedded URL credentials are not allowed"
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase()
  const family = isIP(host)
  if (family) {
    if (!isPublicAddress(host)) return "nonpublic IP destination is not allowed"
  } else if (
    !host.includes(".") ||
    "localhost local internal intranet private corp home lan home.arpa localdomain localdomain4 localdomain6 test invalid example alt onion"
      .split(" ")
      .some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  ) {
    return "local or reserved hostname destination is not allowed"
  }
}
