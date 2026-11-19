export interface ZipArchiveLimits {
  maximumEntries: number
  maximumEntryBytes: (name: string) => number
  maximumTotalBytes: number
}

export interface ZipArchiveEntry {
  name: string
  bytes: Buffer
}
