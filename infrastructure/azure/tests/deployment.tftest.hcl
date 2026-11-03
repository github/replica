mock_provider "azurerm" {
  override_during = plan
  mock_resource "azurerm_virtual_network" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.Network/virtualNetworks/test"
    }
  }
  mock_resource "azurerm_subnet" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.Network/virtualNetworks/test/subnets/test"
    }
  }
  mock_resource "azurerm_private_dns_zone" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.Network/privateDnsZones/test.postgres.database.azure.com"
    }
  }
  mock_resource "azurerm_postgresql_flexible_server" {
    defaults = {
      id   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.DBforPostgreSQL/flexibleServers/test"
      fqdn = "test.postgres.database.azure.com"
    }
  }
  mock_resource "azurerm_storage_account" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.Storage/storageAccounts/testhub"
    }
  }
  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test"
      client_id    = "00000000-0000-0000-0000-000000000001"
      principal_id = "00000000-0000-0000-0000-000000000002"
    }
  }
  mock_resource "azurerm_log_analytics_workspace" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.OperationalInsights/workspaces/test"
    }
  }
  mock_resource "azurerm_container_app_environment" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/managedEnvironments/test"
    }
  }
}

variables {
  subscription_id         = "00000000-0000-0000-0000-000000000000"
  name                    = "test-hub"
  owner                   = "test-team"
  location                = "eastus2"
  image                   = "example.azurecr.io/hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  postgres_admin_password = "NotARealPassword-12345"
}

run "bootstrap_keeps_hub_stopped" {
  command = plan

  assert {
    condition     = length(azurerm_container_app.hub) == 0
    error_message = "Bootstrap must not create a combined process before setup."
  }
  assert {
    condition = (
      azurerm_container_app_job.setup.template[0].container[0].command == tolist(["node", "dist/server/scripts/setup/index.js"]) &&
      azurerm_container_app_job.setup.manual_trigger_config[0].parallelism == 1 &&
      azurerm_container_app_job.setup.replica_retry_limit == 0
    )
    error_message = "Setup must run explicitly, once per execution, without automatic retries."
  }
}

run "durable_state_requires_private_authenticated_access" {
  command = plan

  assert {
    condition = (
      !azurerm_postgresql_flexible_server.database.public_network_access_enabled &&
      azurerm_postgresql_flexible_server_configuration.tls.value == "on" &&
      endswith(nonsensitive(local.database_url), "?sslmode=verify-full") &&
      azurerm_postgresql_flexible_server.database.backup_retention_days >= 7
    )
    error_message = "PostgreSQL must be private, TLS-only, and retain recoverable backups."
  }
  assert {
    condition = (
      !azurerm_storage_account.artifacts.allow_nested_items_to_be_public &&
      !azurerm_storage_account.artifacts.shared_access_key_enabled &&
      azurerm_storage_container.artifacts.container_access_type == "private" &&
      azurerm_storage_account.artifacts.blob_properties[0].versioning_enabled &&
      endswith(azurerm_role_assignment.artifacts.scope, "/blobServices/default/containers/artifacts") &&
      azurerm_role_assignment.artifacts.role_definition_name == "Storage Blob Data Contributor" &&
      length(azurerm_role_assignment.image_pull) == 0
    )
    error_message = "The workload needs container-scoped Blob access, not keys or registry permissions by default."
  }
}

run "combined_release_uses_one_image_and_bounded_shutdown" {
  command = plan

  variables {
    deploy_hub = true
    acr_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/existing/providers/Microsoft.ContainerRegistry/registries/existing"
  }

  assert {
    condition = (
      azurerm_container_app.hub[0].template[0].min_replicas == 1 &&
      azurerm_container_app.hub[0].template[0].max_replicas == 1 &&
      azurerm_container_app.hub[0].revision_mode == "Multiple" &&
      azurerm_container_app.hub[0].template[0].termination_grace_period_seconds >= 35 &&
      azurerm_container_app.hub[0].template[0].termination_grace_period_seconds <= 60 &&
      azurerm_container_app.hub[0].template[0].container[0].image == azurerm_container_app_job.setup.template[0].container[0].image &&
      azurerm_role_assignment.image_pull[0].scope == var.acr_id
    )
    error_message = "Combined Hub and setup must use the same digest, with bounded shutdown and explicit ACR access."
  }
  assert {
    condition = (
      azurerm_container_app.hub[0].ingress[0].external_enabled &&
      !azurerm_container_app.hub[0].ingress[0].allow_insecure_connections &&
      one(azurerm_container_app.hub[0].template[0].container[0].readiness_probe).path == "/api/ready" &&
      one(azurerm_container_app.hub[0].template[0].container[0].liveness_probe).path == "/api/health" &&
      local.runtime_environment.RUNTIME_MODE == "combined" &&
      local.runtime_environment.AZURE_STORAGE_CONTAINER == "artifacts"
    )
    error_message = "HTTPS, dependency readiness, process liveness, and runtime configuration must match Hub."
  }
}

run "mutable_image_is_rejected" {
  command = plan
  variables {
    image = "example.azurecr.io/hub:latest"
  }
  expect_failures = [var.image]
}

run "hostname_without_certificate_is_rejected" {
  command = plan
  variables {
    custom_hostname = "hub.example.com"
  }
  expect_failures = [var.certificate_id]
}
