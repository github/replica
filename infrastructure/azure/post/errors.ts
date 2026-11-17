export class PostSetupExit extends DOMException {
  readonly partialChanges: boolean

  constructor(
    message = "Post-setup stopped. Saved answers and completed secret versions are preserved; run setup:post to resume.",
    partialChanges = false,
  ) {
    super(message, partialChanges ? "PostSetupPartialExit" : "AbortError")
    this.partialChanges = partialChanges
  }
}
