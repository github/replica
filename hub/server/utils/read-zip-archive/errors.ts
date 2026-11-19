export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ZipArchiveError"
  }
}
