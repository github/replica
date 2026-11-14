import type { CommandExecutionError } from "../../../installer/command/index.ts"

export function retryableProvisioningFailure(error: CommandExecutionError): boolean {
  const details = error.details()
  if (
    error.aborted ||
    error.exitCode !== 1 ||
    !details ||
    details.includes("Error details truncated after 64 KiB.")
  )
    return false
  const errors = details.split(/(?:^|\n)[\t \u2502]*Error:/).slice(1)
  return (
    errors.length > 0 &&
    errors.every(
      (error) =>
        (/\bwith\s+azurerm_postgresql_flexible_server\.database[,\s]/.test(error) &&
          /\bSkuNotAvailable\b/.test(error)) ||
        (/\bwith\s+azurerm_storage_blob\.release_lock[,\s]/.test(error) &&
          /unexpected status 403\b/i.test(error) &&
          /not authorized|AuthorizationPermissionMismatch/i.test(error)) ||
        (/\bwith\s+azurerm_container_app_job\.(?:setup|provision)[,\s]/.test(error) &&
          /unable to pull image using Managed identity/i.test(error)),
    )
  )
}
