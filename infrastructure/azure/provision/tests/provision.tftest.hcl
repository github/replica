mock_provider "azurerm" {
  override_during = plan
  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/provision"
      principal_id = "00000000-0000-0000-0000-000000000001"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  name            = "test-hub"
  location        = "eastus2"
  resource_group  = "test-hub"
  environment_id  = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/managedEnvironments/test"
  registry_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.ContainerRegistry/registries/testregistry"
  image           = "testregistry.azurecr.io/replica-hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  vault_id        = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.KeyVault/vaults/testvault"
  secret_urls = {
    DATABASE_URL           = "https://testvault.vault.azure.net/secrets/postgres-admin-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
  }
}

run "fresh_database_job_is_explicit_and_has_separate_access" {
  command = plan
  assert {
    condition = (
      azurerm_container_app_job.provision.replica_retry_limit == 0 &&
      azurerm_container_app_job.provision.manual_trigger_config[0].parallelism == 1 &&
      azurerm_container_app_job.provision.template[0].container[0].command == tolist(["node", "dist/server/scripts/provision-database-access/index.js"]) &&
      length(azurerm_container_app_job.provision.secret) == 3 &&
      length(azurerm_role_assignment.secrets) == 3 &&
      alltrue([for secret in azurerm_container_app_job.provision.secret :
        secret.identity == azurerm_user_assigned_identity.provision.id &&
        (secret.value == null || secret.value == "")
      ])
    )
    error_message = "Fresh provisioning must use its own identity and Key Vault references, and never retry automatically."
  }
}
