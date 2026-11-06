mock_provider "azurerm" {
  mock_data "azurerm_client_config" {
    defaults = {
      object_id = "00000000-0000-0000-0000-000000000001"
    }
  }
  mock_resource "azurerm_container_registry" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.ContainerRegistry/registries/testhubregistry"
    }
  }
  mock_resource "azurerm_key_vault" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.KeyVault/vaults/testhubvault"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  tenant_id       = "00000000-0000-0000-0000-000000000000"
  name            = "test-hub"
  location        = "eastus2"
  owner           = "test-team"
  registry_name   = "testhubregistry"
  vault_name      = "testhubvault"
}

run "foundation_protects_secrets_and_registry" {
  command = plan
  assert {
    condition = (
      !azurerm_container_registry.hub.admin_enabled &&
      azurerm_key_vault.hub.rbac_authorization_enabled &&
      azurerm_key_vault.hub.purge_protection_enabled &&
      azurerm_key_vault.hub.soft_delete_retention_days == 90 &&
      azurerm_role_assignment.image_push.role_definition_name == "AcrPush" &&
      azurerm_role_assignment.secrets.role_definition_name == "Key Vault Secrets Officer"
    )
    error_message = "The foundation requires identity-based registry and vault access with recoverable secrets."
  }
}
