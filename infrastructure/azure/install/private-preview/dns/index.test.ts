import { describe, expect, it } from "vitest"

import { dnsRecordsReady, formatDnsRecords, readerDnsRecords, type DnsResolver } from "./index.ts"

const records = readerDnsRecords("preview.replica.coreai.design", "sample-preview.example.azurecontainerapps.io", "ABC123")

describe("reader DNS records", () => {
  it("lists the exact CNAME and asuid TXT records for the reader hostname", () => {
    expect(records).toEqual([
      { type: "CNAME", name: "preview.replica.coreai.design", value: "sample-preview.example.azurecontainerapps.io" },
      { type: "TXT", name: "asuid.preview.replica.coreai.design", value: "ABC123" },
    ])
    const lines = formatDnsRecords(records).split("\n")
    records.forEach(({ type, name, value }, index) => {
      expect(lines[index]!.split(/\s+/)).toEqual(expect.arrayContaining([type, name, value]))
    })
  })

  it("is ready when DNS answers both records, allowing a trailing dot and split TXT strings", async () => {
    const resolver: DnsResolver = {
      cname: async () => ["Sample-Preview.example.azurecontainerapps.io."],
      txt: async () => [["other"], ["ABC", "123"]],
    }

    await expect(dnsRecordsReady(records, resolver)).resolves.toBe(true)
  })

  it.each([
    ["the CNAME points elsewhere", { cname: async () => ["elsewhere.example.com"], txt: async () => [["ABC123"]] }],
    ["the TXT record is missing", { cname: async () => ["sample-preview.example.azurecontainerapps.io"], txt: async () => { throw new Error("ENODATA") } }],
  ])("is not ready when %s", async (_, resolver: DnsResolver) => {
    await expect(dnsRecordsReady(records, resolver)).resolves.toBe(false)
  })
})
