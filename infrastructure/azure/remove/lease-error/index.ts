export interface RemovalLeaseTarget {
  installation: string
  subscription: string
  kind: "terraform" | "installation" | "release"
  account: string
  container: string
  blob: string
}

export class RemovalLeaseError extends Error {
  readonly knownRetained: boolean
  readonly target: RemovalLeaseTarget

  constructor(target: RemovalLeaseTarget, lease: unknown, reason?: string) {
    const value =
      lease && typeof lease === "object" && !Array.isArray(lease)
        ? (lease as Record<string, unknown>)
        : {}
    const status =
      typeof value.status === "string" && ["locked", "unlocked"].includes(value.status)
        ? value.status
        : "unknown"
    const state =
      typeof value.state === "string" &&
      ["available", "leased", "expired", "breaking", "broken"].includes(value.state)
        ? value.state
        : "unknown"
    const duration =
      typeof value.duration === "string" && ["fixed", "infinite"].includes(value.duration)
        ? value.duration
        : "not supplied or unknown"
    const label =
      target.kind === "terraform"
        ? "Terraform state lock"
        : target.kind === "installation"
          ? "Installation lock"
          : "Release lock"
    super(
      [
        `Removal blocked for ${target.installation}: ${label}.`,
        `Subscription: ${target.subscription}`,
        `Blob: ${target.account}/${target.container}/${target.blob}`,
        `Current lease: status=${status}, state=${state}, duration=${duration}.`,
        status === "locked"
          ? "The blob is leased; this metadata does not identify whether the owner process is still running."
          : "Lease metadata is missing or inconsistent. That is not proof of an active owner, and removal will not guess that it is safe.",
        target.kind === "terraform"
          ? "This is Terraform's state lock, not the installer's operational lock. Scoped recovery requires valid lock metadata and stable safety evidence; changing or unidentified state is not force-unlocked."
          : "A lease does not prove that its owner has stopped. Confirmed removal can recover only a known infinite operational lease after ownership, state, job, and Hub safety checks.",
        ...(reason ? [reason] : []),
        "Rechecking is read-only. No lease was cleared by this inspection.",
      ].join("\n"),
    )
    this.name = "RemovalLeaseError"
    this.target = target
    this.knownRetained =
      target.kind !== "terraform" &&
      status === "locked" &&
      state === "leased" &&
      duration === "infinite"
  }
}
