variable "subscription_id" {
  type        = string
  description = "Explicit Azure subscription for this installation."
}

variable "name" {
  type        = string
  description = "Globally unique installation prefix, also used to confirm ownership."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,18}[a-z0-9]$", var.name)) && !strcontains(var.name, "--")
    error_message = "Use 4–20 lowercase letters, digits, or single hyphens, beginning with a letter."
  }
}

variable "location" {
  type        = string
  description = "Azure region supporting Container Apps and PostgreSQL Flexible Server."
}

variable "resource_group_name" {
  type        = string
  default     = null
  description = "Optional dedicated installation resource group name. Existing unmanaged groups are not adopted automatically."
}

variable "owner" {
  type        = string
  description = "Team responsible for cost, releases, and recovery."

  validation {
    condition     = length(trimspace(var.owner)) > 0
    error_message = "An installation owner is required."
  }
}

variable "image" {
  type        = string
  description = "Existing public or ACR image pinned to an immutable SHA-256 digest."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Supply a registry/repository@sha256:<64 lowercase hex characters>, not a tag."
  }
}

variable "deploy_hub" {
  type        = bool
  default     = false
  description = "Keep false for bootstrap. Only deploy-hub enables Hub after setup succeeds."
}

variable "acr_id" {
  type        = string
  default     = null
  description = "Optional existing ACR resource ID. No registry is created or deleted."
}

variable "postgres_admin_password" {
  type        = string
  sensitive   = true
  description = "Explicit PostgreSQL administrator password. Stored in protected Terraform state."

  validation {
    condition     = length(var.postgres_admin_password) >= 16
    error_message = "Use an independently generated PostgreSQL password of at least 16 characters."
  }
}

variable "postgres_sku" {
  type        = string
  default     = "B_Standard_B1ms"
  description = "PostgreSQL Flexible Server SKU; assess capacity before production use."
}

variable "postgres_version" {
  type        = string
  default     = "17"
  description = "PostgreSQL major version supported by Hub and the selected region."
}

variable "backup_retention_days" {
  type        = number
  default     = 14
  description = "PostgreSQL point-in-time recovery retention."

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "PostgreSQL retention must be between 7 and 35 days."
  }
}

variable "runtime_database_secret" {
  type = object({
    key_vault_id = string
    secret_id    = string
  })
  description = "Existing RBAC Key Vault and HTTPS secret URL containing the replica_runtime database URL with sslmode=verify-full. Never supply the administrator URL."

  validation {
    condition = (
      can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", var.runtime_database_secret.key_vault_id)) &&
      can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}(/[a-fA-F0-9]{32})?$", var.runtime_database_secret.secret_id)) &&
      lower(try(split("/", var.runtime_database_secret.secret_id)[2], "")) == "${lower(try(split("/", var.runtime_database_secret.key_vault_id)[8], ""))}.vault.azure.net"
    )
    error_message = "Supply a Key Vault resource ID and a public-cloud HTTPS secret URL, not a secret value."
  }
}

variable "setup_database_secret" {
  type = object({
    key_vault_id = string
    secret_id    = string
  })
  description = "Existing RBAC Key Vault and HTTPS secret URL containing the replica_migration database URL with sslmode=verify-full."

  validation {
    condition = (
      can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", var.setup_database_secret.key_vault_id)) &&
      can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}(/[a-fA-F0-9]{32})?$", var.setup_database_secret.secret_id)) &&
      lower(try(split("/", var.setup_database_secret.secret_id)[2], "")) == "${lower(try(split("/", var.setup_database_secret.key_vault_id)[8], ""))}.vault.azure.net" &&
      lower("${var.setup_database_secret.key_vault_id}/secrets/${try(split("/", var.setup_database_secret.secret_id)[4], "")}") != lower("${var.runtime_database_secret.key_vault_id}/secrets/${try(split("/", var.runtime_database_secret.secret_id)[4], "")}")
    )
    error_message = "Supply a separate migration secret URL and its Key Vault resource ID."
  }
}

variable "runtime_secret_references" {
  type = map(object({
    key_vault_id = string
    secret_id    = string
  }))
  default     = {}
  description = "Existing RBAC Key Vault secret references keyed by uppercase runtime environment name. Values remain outside Terraform."

  validation {
    condition = length(keys(var.runtime_secret_references)) <= 63 && alltrue([
      for name in keys(var.runtime_secret_references) :
      can(regex("^[A-Z][A-Z0-9_]{0,40}$", name)) &&
      !contains(["DATABASE_URL", "DATABASE_RUNTIME_ROLE", "NODE_ENV", "RUNTIME_MODE", "HOST", "PORT", "CLIENT_DIRECTORY", "SHUTDOWN_TIMEOUT_MS", "ARTIFACT_STORAGE_PROVIDER", "ARTIFACT_STORAGE_DIRECTORY", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER", "AZURE_CLIENT_ID", "AZURE_KEY_VAULT_SECRET_REFERENCES"], name)
    ])
    error_message = "Supply at most 63 additional secret references, using uppercase environment names of at most 41 characters; deployment-owned settings cannot be overridden."
  }

  validation {
    condition = alltrue([
      for secret in values(var.runtime_secret_references) :
      can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", secret.key_vault_id)) &&
      can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}(/[a-fA-F0-9]{32})?$", secret.secret_id)) &&
      lower(try(split("/", secret.secret_id)[2], "")) == "${lower(try(split("/", secret.key_vault_id)[8], ""))}.vault.azure.net" &&
      lower("${secret.key_vault_id}/secrets/${try(split("/", secret.secret_id)[4], "")}") != lower("${var.setup_database_secret.key_vault_id}/secrets/${try(split("/", var.setup_database_secret.secret_id)[4], "")}")
    ])
    error_message = "Supply Key Vault resource IDs and HTTPS secret URLs, not secret values."
  }
}

variable "custom_hostname" {
  type        = string
  default     = null
  description = "Optional DNS hostname already verified for this app."
}

variable "certificate_id" {
  type        = string
  default     = null
  description = "Existing Container Apps environment certificate ID for custom_hostname."

  validation {
    condition     = (var.custom_hostname == null) == (var.certificate_id == null)
    error_message = "Supply both custom_hostname and certificate_id, or neither."
  }
}
