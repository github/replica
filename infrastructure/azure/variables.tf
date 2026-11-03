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
  description = "Keep false for bootstrap. Only deploy.py enables Hub after setup succeeds."
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

variable "runtime_secrets" {
  type        = map(string)
  sensitive   = true
  default     = {}
  description = "Explicit additional runtime secret values keyed by uppercase environment name."

  validation {
    condition = alltrue([
      for name in keys(var.runtime_secrets) :
      can(regex("^[A-Z][A-Z0-9_]{0,40}$", name)) &&
      !contains(["DATABASE_URL", "NODE_ENV", "RUNTIME_MODE", "HOST", "PORT", "CLIENT_DIRECTORY", "SHUTDOWN_TIMEOUT_MS", "ARTIFACT_STORAGE_PROVIDER", "ARTIFACT_STORAGE_DIRECTORY", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER", "AZURE_CLIENT_ID"], name)
    ])
    error_message = "Use uppercase environment names of at most 41 characters; deployment-owned settings cannot be overridden."
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
