export function ensureProviderAdmissionPolicy(
  provider: "github" | "oidc",
  environment: NodeJS.ProcessEnv,
): void {
  const policy = environment.HUB_ADMISSION_POLICY ?? "hub-managed"
  if (provider === "oidc" && policy !== "hub-managed") {
    throw new Error("OIDC authentication requires HUB_ADMISSION_POLICY=hub-managed.")
  }
}
