terraform {
  required_version = ">= 1.13.0, < 2.0.0"
  backend "azurerm" {}
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "= 4.50.0"
    }
  }
}

provider "azurerm" {
  subscription_id                 = var.subscription_id
  resource_provider_registrations = "none"
  features {}
}

variable "subscription_id" { type = string }
variable "name" { type = string }
variable "location" { type = string }
variable "resource_group" { type = string }
variable "environment_id" { type = string }
variable "registry_id" {
  type        = string
  default     = null
  description = "Optional existing ACR resource ID. Omit for a public image."
}
variable "image" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Use an immutable registry/repository@sha256 digest for provisioning."
  }
}
variable "vault_id" {
  type = string
  validation {
    condition     = can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", var.vault_id))
    error_message = "Supply the Key Vault resource ID that owns the provisioning secrets."
  }
}
variable "secret_urls" {
  type = map(string)
  validation {
    condition = (
      toset(keys(var.secret_urls)) == toset(["DATABASE_URL", "HUB_MIGRATION_PASSWORD", "HUB_RUNTIME_PASSWORD"]) &&
      alltrue([for secret in values(var.secret_urls) :
        can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}/[a-fA-F0-9]{32}$", secret))
      ])
    )
    error_message = "Provide exactly three versioned Key Vault references for the administrator URL and two role passwords, never raw values."
  }
  validation {
    condition = (
      !can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", var.vault_id)) ||
      alltrue([for secret in values(var.secret_urls) :
        lower(try(split("/", secret)[2], "")) == "${lower(try(split("/", var.vault_id)[8], ""))}.vault.azure.net"
      ])
    )
    error_message = "Every provisioning secret URL must belong to vault_id."
  }
}

resource "azurerm_user_assigned_identity" "provision" {
  name                = "${var.name}-provision"
  location            = var.location
  resource_group_name = var.resource_group
}

resource "azurerm_role_assignment" "secrets" {
  for_each             = var.secret_urls
  scope                = "${var.vault_id}/secrets/${split("/", each.value)[4]}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.provision.principal_id
}

resource "azurerm_role_assignment" "image" {
  count                = var.registry_id == null ? 0 : 1
  scope                = var.registry_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.provision.principal_id
}

resource "azurerm_container_app_job" "provision" {
  name                         = "${var.name}-provision"
  location                     = var.location
  resource_group_name          = var.resource_group
  container_app_environment_id = var.environment_id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 600
  replica_retry_limit          = 0

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.provision.id]
  }
  dynamic "registry" {
    for_each = var.registry_id == null ? [] : [var.registry_id]
    content {
      server   = split("/", var.image)[0]
      identity = azurerm_user_assigned_identity.provision.id
    }
  }
  template {
    container {
      name    = "provision"
      image   = var.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "dist/server/scripts/azure-entrypoint/index.js", "provision"]
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.provision.client_id
      }
      env {
        name  = "AZURE_KEY_VAULT_SECRET_REFERENCES"
        value = jsonencode(var.secret_urls)
      }
    }
  }
  depends_on = [azurerm_role_assignment.secrets, azurerm_role_assignment.image]
}

output "job_name" { value = azurerm_container_app_job.provision.name }
