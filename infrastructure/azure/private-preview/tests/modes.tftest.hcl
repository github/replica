mock_provider "azurerm" {
  override_during = plan

  mock_resource "azurerm_container_app_environment" {
    defaults = {
      default_domain = "calm-1234.eastus2.azurecontainerapps.io"
      id             = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-preview/providers/Microsoft.App/managedEnvironments/test-preview"
    }
  }

  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-preview/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-preview"
      principal_id = "00000000-0000-0000-0000-000000000002"
      client_id    = "00000000-0000-0000-0000-000000000003"
    }
  }

  mock_resource "azurerm_container_app" {
    defaults = {
      id                            = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-preview/providers/Microsoft.App/containerApps/test-hub-preview"
      custom_domain_verification_id = "VERIFICATIONID"
    }
  }

  mock_resource "azurerm_role_definition" {
    defaults = {
      role_definition_resource_id = "/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Authorization/roleDefinitions/00000000-0000-0000-0000-000000000009"
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


run "enable_the_shared_reader_on_a_generated_hostname" {
  command = plan

  variables {
    reader                 = "enabled"
    inline_enabled         = true
    hub_application_origin = "https://test-hub-hub.other-5678.eastus2.azurecontainerapps.io"
    trusted_proxy_hops     = 1
    reader_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-foundation/providers/Microsoft.KeyVault/vaults/replica-test"
      secret_id    = "https://replica-test.vault.azure.net/secrets/private-preview-reader-secret/0123456789abcdef0123456789abcdef"
    }
  }

  assert {
    condition = (
      length(azurerm_container_app.reader) == 1 &&
      one(azurerm_container_app.reader[0].ingress).external_enabled &&
      !one(azurerm_container_app.reader[0].ingress).allow_insecure_connections &&
      one(azurerm_container_app.reader[0].ingress).target_port == 3002 &&
      one(azurerm_container_app.reader[0].template[0].container).command == tolist(["node", "dist/server/scripts/start-private-preview-reader/index.js"]) &&
      one(azurerm_container_app.reader[0].template[0].container).image == var.image &&
      length(azurerm_container_app_custom_domain.reader) == 0
    )
    error_message = "An enabled reader runs the pinned image's reader command behind HTTPS-only ingress."
  }

  assert {
    condition = (
      output.reader.origin == "https://test-hub-preview.calm-1234.eastus2.azurecontainerapps.io" &&
      { for setting in one(azurerm_container_app.reader[0].template[0].container).env : setting.name => setting.value if setting.secret_name == null || setting.secret_name == "" } == {
        NODE_ENV                           = "production"
        HOST                               = "0.0.0.0"
        PORT                               = "3002"
        HUB_PRIVATE_PREVIEW_ENABLED        = "true"
        HUB_APPLICATION_ORIGIN             = var.hub_application_origin
        HUB_PRIVATE_PREVIEW_ORIGIN         = "https://test-hub-preview.calm-1234.eastus2.azurecontainerapps.io"
        HUB_PRIVATE_PREVIEW_INLINE_ENABLED = "true"
        PRIVATE_PREVIEW_TRUSTED_PROXY_HOPS = "1"
        ARTIFACT_STORAGE_PROVIDER          = "azure"
        AZURE_STORAGE_ACCOUNT              = "testhubhub"
        AZURE_STORAGE_CONTAINER            = "private-preview-artifacts"
        AZURE_CLIENT_ID                    = "00000000-0000-0000-0000-000000000003"
      }
    )
    error_message = "The reader gets the exact Hub and reader origins, the inline setting, and only its dedicated container."
  }

  assert {
    condition = (
      one(azurerm_container_app.reader[0].secret).key_vault_secret_id == var.reader_secret.secret_id &&
      one(azurerm_container_app.reader[0].secret).identity == azurerm_user_assigned_identity.reader.id &&
      one([for setting in one(azurerm_container_app.reader[0].template[0].container).env : setting if setting.name == "HUB_PRIVATE_PREVIEW_READER_SECRET"]).secret_name == one(azurerm_container_app.reader[0].secret).name &&
      azurerm_role_assignment.reader_secret[0].scope == "${var.reader_secret.key_vault_id}/secrets/private-preview-reader-secret" &&
      azurerm_role_assignment.reader_secret[0].role_definition_name == "Key Vault Secrets User" &&
      azurerm_role_assignment.reader_secret[0].principal_id == azurerm_user_assigned_identity.reader.principal_id &&
      !anytrue([for setting in one(azurerm_container_app.reader[0].template[0].container).env : contains(["DATABASE_URL", "AZURE_KEY_VAULT_SECRET_REFERENCES", "GITHUB_APP_PRIVATE_KEY_BASE64"], setting.name)])
    )
    error_message = "Only the reader identity can read the one shared reader secret; the reader gets no database or GitHub credentials."
  }

  assert {
    condition     = length(azurerm_role_definition.writer) == 0 && length(azurerm_role_assignment.writer) == 0
    error_message = "The writer stays off unless the operator opts in."
  }
}

run "bind_a_custom_hostname_with_a_managed_certificate" {
  command = plan

  variables {
    reader                 = "enabled"
    hub_application_origin = "https://replica.example.com"
    trusted_proxy_hops     = 1
    custom_hostname        = "preview.replica.example.com"
    bind_custom_hostname   = true
    reader_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-foundation/providers/Microsoft.KeyVault/vaults/replica-test"
      secret_id    = "https://replica-test.vault.azure.net/secrets/private-preview-reader-secret"
    }
  }

  assert {
    condition = (
      azurerm_container_app_custom_domain.reader[0].name == "preview.replica.example.com" &&
      azurerm_container_app_custom_domain.reader[0].container_app_environment_certificate_id == null &&
      output.reader.origin == "https://preview.replica.example.com" &&
      output.reader.custom_domain_verification_id == "VERIFICATIONID" &&
      one([for setting in one(azurerm_container_app.reader[0].template[0].container).env : setting if setting.name == "HUB_PRIVATE_PREVIEW_INLINE_ENABLED"]).value == "false"
    )
    error_message = "A fixed hostname is added without a supplied certificate, so Azure can issue a managed one."
  }
}

run "use_the_custom_origin_before_the_hostname_is_bound" {
  command = plan

  variables {
    reader                 = "enabled"
    hub_application_origin = "https://replica.example.com"
    trusted_proxy_hops     = 1
    custom_hostname        = "preview.replica.example.com"
    reader_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test-hub-foundation/providers/Microsoft.KeyVault/vaults/replica-test"
      secret_id    = "https://replica-test.vault.azure.net/secrets/private-preview-reader-secret"
    }
  }

  assert {
    condition = (
      length(azurerm_container_app_custom_domain.reader) == 0 &&
      output.reader.origin == "https://preview.replica.example.com" &&
      output.reader.generated_hostname != null &&
      output.reader.custom_domain_verification_id == "VERIFICATIONID"
    )
    error_message = "Before DNS is ready, the reader already uses its same-site custom origin and reports the DNS values."
  }
}

run "reject_inline_without_an_enabled_reader" {
  command = plan

  variables {
    inline_enabled = true
  }

  expect_failures = [azurerm_container_app.reader]
}

run "reject_an_enabled_reader_without_hub_settings" {
  command = plan

  variables {
    reader = "enabled"
  }

  expect_failures = [azurerm_container_app.reader]
}

run "publish_new_builds_with_a_create_only_writer" {
  command = plan

  variables {
    writer_principal_id = "00000000-0000-0000-0000-000000000004"
  }

  assert {
    condition = (
      azurerm_role_definition.writer[0].scope == "/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}" &&
      azurerm_role_definition.writer[0].assignable_scopes == tolist(["/subscriptions/${var.subscription_id}/resourceGroups/${var.resource_group_name}"]) &&
      one(azurerm_role_definition.writer[0].permissions).data_actions == toset([
        "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action",
        "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
      ]) &&
      length(coalesce(one(azurerm_role_definition.writer[0].permissions).actions, [])) == 0 &&
      length(coalesce(one(azurerm_role_definition.writer[0].permissions).not_data_actions, [])) == 0
    )
    error_message = "The writer role may only create new blobs and read them back."
  }

  assert {
    condition = (
      azurerm_role_assignment.writer[0].principal_id == var.writer_principal_id &&
      azurerm_role_assignment.writer[0].scope == "${var.storage_account_id}/blobServices/default/containers/private-preview-artifacts" &&
      azurerm_role_assignment.writer[0].condition_version == "2.0" &&
      azurerm_role_assignment.writer[0].condition == azurerm_role_assignment.reader_artifacts[0].condition &&
      length(one(azurerm_container_app.reader[0].template[0].container).env) == 0
    )
    error_message = "The Hub identity gets listing-denied create and read access on the dedicated container only, and the reader stays disabled."
  }
}

run "roll_back_without_touching_stored_builds" {
  command = plan

  variables {
    reader = "absent"
  }

  assert {
    condition = (
      length(azurerm_container_app.reader) == 0 &&
      length(azurerm_role_assignment.image_pull) == 0 &&
      length(azurerm_role_assignment.reader_artifacts) == 0 &&
      length(azurerm_role_assignment.reader_secret) == 0 &&
      length(azurerm_container_app_custom_domain.reader) == 0 &&
      length(azurerm_role_assignment.writer) == 0 &&
      azurerm_storage_container.reader.name == "private-preview-artifacts" &&
      output.reader.origin == null
    )
    error_message = "Rollback removes the reader app and every grant, and keeps the container that holds published Builds."
  }
}
