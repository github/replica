import { realpathSync } from "node:fs"
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

export function checkPublicUrl(value) {
  if (typeof value !== "string" || !value.trim() || !URL.canParse(value))
    return "requires an absolute HTTP(S) URL"
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)) return "requires an absolute HTTP(S) URL"
  if (url.username || url.password) return "embedded URL credentials are not allowed"

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase()
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
      "home.arpa",
      "localdomain",
      "localdomain4",
      "localdomain6",
    ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  ) {
    return "local hostname destination is not allowed"
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (process.argv.length !== 3) {
    console.error("Usage: node check-public-url.mjs URL")
    process.exit(2)
  }
  const problem = checkPublicUrl(process.argv[2])
  if (problem) {
    console.error(`Cannot use reference URL: ${problem}.`)
    process.exit(1)
  }
  console.log("Passed static URL checks; no DNS lookup or network request was performed.")
}
