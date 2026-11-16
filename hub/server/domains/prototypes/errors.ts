export class PrototypeMetadataError extends Error {
  readonly code: "invalid_input" | "not_found" | "not_signed_in"

  constructor(code: PrototypeMetadataError["code"], message: string) {
    super(message)
    this.name = "PrototypeMetadataError"
    this.code = code
  }
}
