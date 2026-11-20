export class GitHubMaintenanceInputError extends Error {
  constructor(reason: "repair-usage" | "webhook-usage" | "configuration") {
    const messages = {
      "repair-usage":
        "Provide --repository-id and --build-id; add --apply only to save the repair.",
      "webhook-usage":
        "Provide --repository-id, --run-id, and HUB_APPLICATION_ORIGIN; --delivery-guid is optional.",
      configuration: "GitHub App installation settings are incomplete or invalid.",
    }
    super(messages[reason])
    this.name = "GitHubMaintenanceInputError"
  }
}
