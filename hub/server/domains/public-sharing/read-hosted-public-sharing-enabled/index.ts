import { PublicSharingConfigurationError } from "../errors.ts"

export function readHostedPublicSharingEnabled(value: string | undefined) {
  if (value === undefined || value === "false") return false
  if (value === "true") return true
  throw new PublicSharingConfigurationError(
    "HUB_HOSTED_PUBLIC_SHARING_ENABLED must be true or false.",
  )
}
