mock_provider "azurerm" {
  override_during = plan

  mock_resource "azurerm_container_app_environment" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-preview/providers/Microsoft.App/managedEnvironments/test-preview"
    }
  }

  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-preview/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-preview"
      principal_id = "00000000-0000-0000-0000-000000000002"
    }
  }
}

variables {
  subscription_id     = "00000000-0000-0000-0000-000000000001"
  resource_group_name = "test-hub-rg"
  location            = "eastus2"
  name                = "test-hub"
  owner               = "test-team"
  acr_id              = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-rg/providers/Microsoft.ContainerRegistry/registries/testhubregistry"
  registry_server     = "testhubregistry.azurecr.io"
  image               = "testhubregistry.azurecr.io/replica-hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  storage_account_id  = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-rg/providers/Microsoft.Storage/storageAccounts/testhubhub"
}

run "stage_a_disabled_reader_without_activating_preview" {
  command = plan

  assert {
    condition = (
      azurerm_resource_group.reader.name == "${var.name}-preview" &&
      azurerm_resource_group.reader.name != var.resource_group_name &&
      azurerm_container_app.reader.resource_group_name == azurerm_resource_group.reader.name &&
      azurerm_container_app_environment.reader.resource_group_name == azurerm_resource_group.reader.name &&
      azurerm_user_assigned_identity.reader.resource_group_name == azurerm_resource_group.reader.name &&
      azurerm_container_app.reader.container_app_environment_id == azurerm_container_app_environment.reader.id &&
      azurerm_container_app_environment.reader.infrastructure_subnet_id == null &&
      length(azurerm_container_app.reader.ingress) == 0
    )
    error_message = "The staged reader must be isolated from the Hub group in its own environment without a subnet or ingress."
  }

  assert {
    condition = (
      azurerm_container_app.reader.template[0].min_replicas >= 1 &&
      one(azurerm_container_app.reader.template[0].container).image == var.image &&
      one(azurerm_container_app.reader.template[0].container).readiness_probe[0].transport == "TCP" &&
      one(azurerm_container_app.reader.template[0].container).startup_probe[0].transport == "TCP" &&
      one(azurerm_container_app.reader.template[0].container).readiness_probe[0].port == one(azurerm_container_app.reader.template[0].container).startup_probe[0].port &&
      length(one(azurerm_container_app.reader.template[0].container).command) > 0 &&
      !can(regex("start-private-preview-reader|azure-entrypoint", join(" ", one(azurerm_container_app.reader.template[0].container).command)))
    )
    error_message = "The pinned image must run a placeholder for startup and TCP readiness, not the Hub or reader runtime."
  }

  assert {
    condition = (
      length(azurerm_container_app.reader.secret) == 0 &&
      alltrue([
        for setting in one(azurerm_container_app.reader.template[0].container).env :
        (setting.secret_name == null || setting.secret_name == "") &&
        (setting.name != "HUB_PRIVATE_PREVIEW_ENABLED" || setting.value == "false") &&
        !contains(["HUB_PRIVATE_PREVIEW_READER_SECRET", "AZURE_KEY_VAULT_SECRET_REFERENCES", "DATABASE_URL"], setting.name)
      ])
    )
    error_message = "Staging must not activate private preview or supply database, Key Vault, or reader credentials."
  }

  assert {
    condition = (
      one(azurerm_container_app.reader.identity).type == "UserAssigned" &&
      one(azurerm_container_app.reader.identity).identity_ids == toset([azurerm_user_assigned_identity.reader.id]) &&
      one(azurerm_container_app.reader.registry).server == var.registry_server &&
      one(azurerm_container_app.reader.registry).identity == azurerm_user_assigned_identity.reader.id &&
      azurerm_role_assignment.image_pull.principal_id == azurerm_user_assigned_identity.reader.principal_id &&
      azurerm_role_assignment.image_pull.role_definition_name == "AcrPull" &&
      azurerm_role_assignment.image_pull.scope == var.acr_id
    )
    error_message = "Only the dedicated reader identity may pull its image, with AcrPull scoped to the installation registry."
  }

  assert {
    condition = (
      azurerm_storage_container.reader.storage_account_id == var.storage_account_id &&
      azurerm_storage_container.reader.name != "artifacts" &&
      azurerm_storage_container.reader.container_access_type == "private" &&
      azurerm_role_assignment.reader_artifacts.principal_id == azurerm_user_assigned_identity.reader.principal_id &&
      azurerm_role_assignment.reader_artifacts.role_definition_name == "Storage Blob Data Reader" &&
      azurerm_role_assignment.reader_artifacts.scope == "${var.storage_account_id}/blobServices/default/containers/${azurerm_storage_container.reader.name}" &&
      azurerm_role_assignment.reader_artifacts.condition_version == "2.0" &&
      strcontains(azurerm_role_assignment.reader_artifacts.condition, "!(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})")
    )
    error_message = "Grant the dedicated identity read-only, listing-denied access to the private preview container, not the existing artifacts container or storage account."
  }
}

run "reject_a_mutable_reader_image" {
  command = plan

  variables {
    image = "testhubregistry.azurecr.io/replica-hub:latest"
  }

  expect_failures = [var.image]
}
