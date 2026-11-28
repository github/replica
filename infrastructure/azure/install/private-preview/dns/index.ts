import { resolveCname, resolveTxt } from "node:dns/promises"

export interface DnsRecord {
  type: "CNAME" | "TXT"
  name: string
  value: string
}

export interface DnsResolver {
  cname(name: string): Promise<string[]>
  txt(name: string): Promise<string[][]>
}

export const systemResolver: DnsResolver = { cname: resolveCname, txt: resolveTxt }

export function readerDnsRecords(
  hostname: string,
  generatedHostname: string,
  verificationId: string,
): DnsRecord[] {
  return [
    { type: "CNAME", name: hostname, value: generatedHostname },
    { type: "TXT", name: `asuid.${hostname}`, value: verificationId },
  ]
}

export function formatDnsRecords(records: DnsRecord[]): string {
  return records.map(({ type, name, value }) => `${type.padEnd(5)} ${name} -> ${value}`).join("\n")
}

// A missing or different answer means not ready; Azure validates again when binding.
export async function dnsRecordsReady(records: DnsRecord[], resolver: DnsResolver) {
  const normalized = (value: string) => value.replace(/\.$/, "").toLowerCase()
  for (const record of records) {
    try {
      if (record.type === "CNAME") {
        const answers = await resolver.cname(record.name)
        if (!answers.some((answer) => normalized(answer) === normalized(record.value))) return false
      } else {
        const answers = await resolver.txt(record.name)
        if (!answers.some((chunks) => chunks.join("") === record.value)) return false
      }
    } catch {
      return false
    }
  }
  return true
}
