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

resource "azurerm_resource_group" "reader" {
  name     = local.reader_name
  location = var.location
  tags     = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

variable "image" {
  type = string
  validation {
    condition     = startswith(var.image, "${var.registry_server}/") && can(regex("^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Use an immutable image digest from the installation registry."
  }
}

locals {
  reader_name = "${var.name}-preview"
  tags = {
    application  = "replica-hub"
    installation = var.name
    owner        = var.owner
    managed_by   = "terraform"
  }
}

resource "azurerm_storage_container" "reader" {
  name                  = "private-preview-artifacts"
  storage_account_id    = var.storage_account_id
  container_access_type = "private"

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_role_assignment" "reader_artifacts" {
  scope                = "${var.storage_account_id}/blobServices/default/containers/${azurerm_storage_container.reader.name}"
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_user_assigned_identity.reader.principal_id

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

resource "azurerm_role_assignment" "image_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.reader.principal_id

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_container_app" "reader" {
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

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "disabled"
      image  = var.image
      cpu    = 0.25
      memory = "0.5Gi"
      # The reader exits when disabled. This listener only checks that the image can start.
      command = ["node", "-e", "require('node:net').createServer(socket => socket.destroy()).listen(3002, '0.0.0.0')"]

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
    prevent_destroy = true
  }

  depends_on = [azurerm_role_assignment.image_pull]
}
