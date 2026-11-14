export class RemovalInspectionError extends Error {
  constructor({
    installation,
    subscription,
    subject,
    reason,
    remedy,
  }: {
    installation: string
    subscription: string
    subject?: string
    reason: string
    remedy: string
  }) {
    super(
      [
        `Removal inspection blocked for ${installation}.`,
        `Subscription: ${subscription}`,
        ...(subject ? [`Resource: ${subject}`] : []),
        `Reason: ${reason}`,
        remedy,
        "Recheck read-only preflight after resolving this condition. No resource was deleted or adopted by this inspection.",
      ].join("\n"),
    )
    this.name = "RemovalInspectionError"
  }
}
