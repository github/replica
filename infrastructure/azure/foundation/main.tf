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

variable "subscription_id" { type = string }
variable "tenant_id" { type = string }
variable "name" { type = string }
variable "location" { type = string }
variable "owner" { type = string }
variable "registry_name" { type = string }
variable "vault_name" { type = string }

data "azurerm_client_config" "deployment" {}

locals {
  tags = {
    application  = "replica-hub"
    installation = var.name
    owner        = var.owner
    managed_by   = "terraform"
    purpose      = "installation-foundation"
  }
}

resource "azurerm_resource_group" "foundation" {
  name     = "${var.name}-foundation"
  location = var.location
  tags     = local.tags
}

resource "azurerm_container_registry" "hub" {
  name                = var.registry_name
  resource_group_name = azurerm_resource_group.foundation.name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_key_vault" "hub" {
  name                       = var.vault_name
  location                   = var.location
  resource_group_name        = azurerm_resource_group.foundation.name
  tenant_id                  = var.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  soft_delete_retention_days = 90
  purge_protection_enabled   = true
  tags                       = local.tags
}

resource "azurerm_role_assignment" "secrets" {
  scope                = azurerm_key_vault.hub.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.deployment.object_id
}

resource "azurerm_role_assignment" "image_push" {
  scope                = azurerm_container_registry.hub.id
  role_definition_name = "AcrPush"
  principal_id         = data.azurerm_client_config.deployment.object_id
}

output "installation" {
  value = {
    vault_id     = azurerm_key_vault.hub.id
    vault_url    = azurerm_key_vault.hub.vault_uri
    registry_id  = azurerm_container_registry.hub.id
    registry_url = azurerm_container_registry.hub.login_server
  }
}
