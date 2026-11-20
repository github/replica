import { BlockList, isIP } from "node:net"
import { parse } from "tldts"

export interface AnalyticsPolicy {
  hubHosts: string[]
  outboundHosts?: Set<string>
}

export class PublicEndpointError extends Error {}

const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const sensitiveQueryKey =
  /(?:^|[._-])(?:auth|pass|key|sig|code)(?:$|[._-])|authorization|authentication|oauth|token|secret|pass(?:word|wd|phrase|code)|credential|signature|bearer|(?:api|access|private|client)key/i

export function isPublicDnsName(host: string) {
  return host.length <= 253 && dnsName.test(host) && !isIP(host) && parse(host).isIcann === true
}

/** Applies before saving a custom endpoint and independently again before each attempt. */
export function parsePublicEndpoint(value: string, policy: AnalyticsPolicy, custom = true) {
  if (
    Buffer.byteLength(value) > 2_048 ||
    !/^https:\/\/[a-z0-9.-]+(?::443)?(?=[/?]|$)/.test(value) ||
    /[^\x21-\x7e]|\\|#|%(?![0-9a-f]{2})/i.test(value)
  ) {
    throw new PublicEndpointError(
      "Use a public HTTPS URL on port 443 without credentials or a fragment.",
    )
  }
  const url = URL.parse(value)
  if (
    !url ||
    url.port ||
    url.username ||
    url.password ||
    !isPublicDnsName(url.hostname) ||
    policy.hubHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ||
    (custom && policy.outboundHosts && !policy.outboundHosts.has(url.hostname))
  ) {
    throw new PublicEndpointError("The destination hostname is not allowed.")
  }
  if (custom && value.includes("?")) {
    const pairs = [...url.searchParams]
    if (
      url.search.length > 513 ||
      pairs.length === 0 ||
      pairs.length > 10 ||
      pairs.some(
        ([key, setting]) =>
          !/^[a-zA-Z0-9_.-]{1,64}$/.test(key) ||
          sensitiveQueryKey.test(key) ||
          Buffer.byteLength(setting) > 128 ||
          /\$secret|\$\{|\{\{|\p{Cc}|\ufffd/u.test(setting),
      )
    ) {
      throw new PublicEndpointError("Query settings must use short, nonsecret key/value pairs.")
    }
  }
  return url
}

const reserved = new BlockList()
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
  ["168.63.129.16", 32],
] as const) {
  reserved.addSubnet(address, bits, "ipv4")
}
for (const [address, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  reserved.addSubnet(address, bits, "ipv6")
}
const globalV6 = new BlockList()
globalV6.addSubnet("2000::", 3, "ipv6")

export function isPublicAnalyticsIp(address: string) {
  if (address.includes("%")) return false
  const family = isIP(address)
  if (family === 4) return !reserved.check(address, "ipv4")
  return family === 6 && globalV6.check(address, "ipv6") && !reserved.check(address, "ipv6")
}
