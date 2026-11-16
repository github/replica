export class PostSetupExit extends DOMException {
  constructor(
    message = "Post-setup stopped. Saved answers and completed secret versions are preserved; run setup:post to resume.",
  ) {
    super(message, "AbortError")
  }
}
