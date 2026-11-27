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
  storage_use_azuread             = true
  resource_provider_registrations = "none"
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

variable "subscription_id" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "name" {
  type = string
}

variable "owner" {
  type = string
}

variable "acr_id" {
  type = string
}

variable "registry_server" {
  type = string
}

variable "storage_account_id" {
  type = string
  validation {
    condition     = lower(var.storage_account_id) == lower("/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}/providers/Microsoft.Storage/storageAccounts/${replace(var.name, "-", "")}hub")
    error_message = "Use the existing installation's artifact storage account."
  }
}


variable "image" {
  type = string
  validation {
    condition     = startswith(var.image, "${var.registry_server}/") && can(regex("^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Use an immutable image digest from the installation registry."
  }
}

variable "reader" {
  description = "absent removes the reader app and its grants, disabled keeps a placeholder without ingress, enabled serves previews."
  type        = string
  default     = "disabled"
  nullable    = false
  validation {
    condition     = contains(["absent", "disabled", "enabled"], var.reader)
    error_message = "Set reader to absent, disabled, or enabled."
  }
}

variable "inline_enabled" {
  type     = bool
  default  = false
  nullable = false
}

variable "hub_application_origin" {
  type    = string
  default = null
  validation {
    condition     = var.hub_application_origin == null || can(regex("^https://[a-z0-9.-]+$", var.hub_application_origin))
    error_message = "Use Hub's exact HTTPS origin without a path or trailing slash."
  }
}

variable "trusted_proxy_hops" {
  type    = number
  default = null
  validation {
    condition     = var.trusted_proxy_hops == null || (floor(coalesce(var.trusted_proxy_hops, 0)) == coalesce(var.trusted_proxy_hops, 0) && coalesce(var.trusted_proxy_hops, 0) >= 1 && coalesce(var.trusted_proxy_hops, 0) <= 10)
    error_message = "Use Hub's verified trusted proxy hop count, from 1 to 10."
  }
}

variable "custom_hostname" {
  type    = string
  default = null
  validation {
    condition     = var.custom_hostname == null || can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$", var.custom_hostname))
    error_message = "Use one lowercase DNS hostname without a wildcard, scheme, or port."
  }
}

variable "bind_custom_hostname" {
  description = "Add the custom hostname to the reader after its DNS records exist."
  type        = bool
  default     = false
  nullable    = false
}

variable "reader_secret" {
  type = object({
    key_vault_id = string
    secret_id    = string
  })
  default = null
}

variable "writer_principal_id" {
  description = "Hub workload identity that publishes new Builds. Null keeps the writer grant absent."
  type        = string
  default     = null
}

locals {
  reader_name  = "${var.name}-preview"
  enabled      = var.reader == "enabled"
  present      = var.reader != "absent"
  writer       = var.writer_principal_id != null
  hub_group_id = "/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}"
  container_id = "${var.storage_account_id}/blobServices/default/containers/${azurerm_storage_container.reader.name}"
  blob_action  = "Microsoft.Storage/storageAccounts/blobServices/containers/blobs"
  # A custom hostname becomes the origin only once it is bound.
  reader_origin = var.bind_custom_hostname ? "https://${var.custom_hostname}" : "https://${local.reader_name}.${azurerm_container_app_environment.reader.default_domain}"
  # Exact text the wizard compares with Azure before accepting or replacing a grant.
  without_listing = trimspace(<<-EOT
    (
      (
        !(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})
      )
    )
  EOT
  )
  disabled_command = ["node", "-e", "require('node:net').createServer(socket => socket.destroy()).listen(3002, '0.0.0.0')"]
  reader_environment = local.enabled ? {
    NODE_ENV                           = "production"
    HOST                               = "0.0.0.0"
    PORT                               = "3002"
    HUB_PRIVATE_PREVIEW_ENABLED        = "true"
    HUB_APPLICATION_ORIGIN             = var.hub_application_origin
    HUB_PRIVATE_PREVIEW_ORIGIN         = local.reader_origin
    HUB_PRIVATE_PREVIEW_INLINE_ENABLED = tostring(var.inline_enabled)
    PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS = tostring(var.trusted_proxy_hops)
    ARTIFACT_STORAGE_PROVIDER          = "azure"
    AZURE_STORAGE_ACCOUNT              = split("/", var.storage_account_id)[8]
    AZURE_STORAGE_CONTAINER            = azurerm_storage_container.reader.name
    AZURE_CLIENT_ID                    = azurerm_user_assigned_identity.reader.client_id
  } : {}
  tags = {
    application  = "replica-hub"
    installation = var.name
    owner        = var.owner
    managed_by   = "terraform"
  }
}

resource "azurerm_resource_group" "reader" {
  name     = local.reader_name
  location = var.location
  tags     = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

# Published Build files. Turning previews off or removing the reader never deletes them.
resource "azurerm_storage_container" "reader" {
  name                  = "private-preview-artifacts"
  storage_account_id    = var.storage_account_id
  container_access_type = "private"

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_container_app_environment" "reader" {
  name                = "${local.reader_name}-environment"
  resource_group_name = azurerm_resource_group.reader.name
  location            = var.location
  tags                = local.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
    minimum_count         = 0
    maximum_count         = 0
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [infrastructure_resource_group_name]
  }
}

resource "azurerm_user_assigned_identity" "reader" {
  name                = local.reader_name
  resource_group_name = azurerm_resource_group.reader.name
  location            = var.location
  tags                = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

moved {
  from = azurerm_role_assignment.image_pull
  to   = azurerm_role_assignment.image_pull[0]
}

moved {
  from = azurerm_role_assignment.reader_artifacts
  to   = azurerm_role_assignment.reader_artifacts[0]
}

moved {
  from = azurerm_container_app.reader
  to   = azurerm_container_app.reader[0]
}

resource "azurerm_role_assignment" "image_pull" {
  count                = local.present ? 1 : 0
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.reader.principal_id
}

# The shared reader reads any published Build by its opaque key, but cannot list the container.
resource "azurerm_role_assignment" "reader_artifacts" {
  count                = local.present ? 1 : 0
  scope                = local.container_id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.reader.principal_id
  condition_version    = "2.0"
  condition            = local.without_listing
}

resource "azurerm_role_assignment" "reader_secret" {
  count                = local.enabled && var.reader_secret != null ? 1 : 0
  scope                = "${var.reader_secret.key_vault_id}/secrets/${split("/", var.reader_secret.secret_id)[4]}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.reader.principal_id
}

resource "azurerm_container_app" "reader" {
  count                        = local.present ? 1 : 0
  name                         = local.reader_name
  resource_group_name          = azurerm_resource_group.reader.name
  container_app_environment_id = azurerm_container_app_environment.reader.id
  workload_profile_name        = "Consumption"
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.reader.id]
  }

  registry {
    server   = var.registry_server
    identity = azurerm_user_assigned_identity.reader.id
  }

  dynamic "secret" {
    for_each = local.enabled && var.reader_secret != null ? [var.reader_secret.secret_id] : []
    content {
      name                = "reader-secret"
      key_vault_secret_id = secret.value
      identity            = azurerm_user_assigned_identity.reader.id
    }
  }

  dynamic "ingress" {
    for_each = local.enabled ? [1] : []
    content {
      external_enabled           = true
      allow_insecure_connections = false
      target_port                = 3002
      transport                  = "http"
      traffic_weight {
        latest_revision = true
        percentage      = 100
      }
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = local.enabled ? "reader" : "disabled"
      image  = var.image
      cpu    = 0.25
      memory = "0.5Gi"
      # The image runs as its non-root user. The disabled listener only checks that the image can start.
      command = local.enabled ? ["node", "dist/server/scripts/start-private-preview-reader/index.js"] : local.disabled_command

      dynamic "env" {
        for_each = local.reader_environment
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.enabled ? ["reader-secret"] : []
        content {
          name        = "HUB_PRIVATE_PREVIEW_READER_SECRET"
          secret_name = env.value
        }
      }

      startup_probe {
        transport = "TCP"
        port      = 3002
      }

      readiness_probe {
        transport = "TCP"
        port      = 3002
      }

      liveness_probe {
        transport = "TCP"
        port      = 3002
      }
    }
  }

  lifecycle {
    precondition {
      condition     = !local.enabled || (var.hub_application_origin != null && var.trusted_proxy_hops != null && var.reader_secret != null)
      error_message = "An enabled reader needs Hub's origin, its trusted proxy hop count, and the shared reader secret."
    }
    precondition {
      condition     = local.enabled || !var.inline_enabled
      error_message = "Inline playback needs an enabled reader."
    }
    precondition {
      condition     = !var.bind_custom_hostname || (local.enabled && var.custom_hostname != null)
      error_message = "Bind a custom hostname only to an enabled reader."
    }
  }

  depends_on = [azurerm_role_assignment.image_pull, azurerm_role_assignment.reader_secret]
}

# Azure issues and binds the managed certificate after the wizard verifies DNS.
resource "azurerm_container_app_custom_domain" "reader" {
  count            = local.enabled && var.bind_custom_hostname ? 1 : 0
  name             = var.custom_hostname
  container_app_id = azurerm_container_app.reader[0].id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

# Publication may create new blobs and read them back. It cannot overwrite, list, or delete.
resource "azurerm_role_definition" "writer" {
  count              = local.writer ? 1 : 0
  role_definition_id = uuidv5("url", "https://replica.invalid/${lower(var.subscription_id)}/${var.name}/private-preview-writer")
  name               = "Replica ${var.name} private preview writer"
  scope              = local.hub_group_id
  assignable_scopes  = [local.hub_group_id]

  permissions {
    data_actions = ["${local.blob_action}/add/action", "${local.blob_action}/read"]
  }
}

resource "azurerm_role_assignment" "writer" {
  count              = local.writer ? 1 : 0
  scope              = local.container_id
  role_definition_id = azurerm_role_definition.writer[0].role_definition_resource_id
  principal_id       = var.writer_principal_id
  principal_type     = "ServicePrincipal"
  condition_version  = "2.0"
  condition          = local.without_listing
}

output "reader" {
  # The verification ID is published in DNS, so it is not secret.
  description = "Reader coordinates and the DNS values for a custom hostname. No credentials are emitted."
  value = {
    mode                          = var.reader
    origin                        = local.enabled ? local.reader_origin : null
    generated_hostname            = local.enabled ? azurerm_container_app.reader[0].ingress[0].fqdn : null
    custom_domain_verification_id = local.enabled ? nonsensitive(azurerm_container_app.reader[0].custom_domain_verification_id) : null
    app_name                      = local.reader_name
    resource_group                = azurerm_resource_group.reader.name
    environment_id                = azurerm_container_app_environment.reader.id
  }
}
