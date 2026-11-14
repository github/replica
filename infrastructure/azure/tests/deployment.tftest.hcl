mock_provider "azurerm" {
  override_during = plan
  mock_data "azurerm_client_config" {
    defaults = {
      object_id = "00000000-0000-0000-0000-000000000005"
    }
  }
  mock_resource "azurerm_resource_group" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub"
    }
  }
  mock_resource "azurerm_container_app" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/containerApps/test-hub-hub"
    }
  }
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

mock_provider "azurerm" {
  alias           = "rerun"
  override_during = apply

  mock_resource "azurerm_container_app_environment" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/managedEnvironments/test"
    }
  }
  mock_resource "azurerm_postgresql_flexible_server" {
    defaults = {
      id   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.DBforPostgreSQL/flexibleServers/test"
      fqdn = "test.postgres.database.azure.com"
    }
  }
}

override_resource {
  target          = azurerm_user_assigned_identity.hub
  override_during = plan
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/hub"
    client_id    = "00000000-0000-0000-0000-000000000001"
    principal_id = "00000000-0000-0000-0000-000000000002"
  }
}

override_resource {
  target          = azurerm_user_assigned_identity.setup
  override_during = plan
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/setup"
    client_id    = "00000000-0000-0000-0000-000000000003"
    principal_id = "00000000-0000-0000-0000-000000000004"
  }
}

variables {
  subscription_id         = "00000000-0000-0000-0000-000000000000"
  name                    = "test-hub"
  owner                   = "test-team"
  location                = "eastus2"
  image                   = "example.azurecr.io/hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  postgres_admin_password = "NotARealPassword-12345"
  runtime_database_secret = {
    key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
    secret_id    = "https://database.vault.azure.net/secrets/runtime-database/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  setup_database_secret = {
    key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
    secret_id    = "https://database.vault.azure.net/secrets/setup-database/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}

run "bootstrap_keeps_hub_stopped" {
  command = plan

  assert {
    condition     = length(azurerm_container_app.hub) == 0
    error_message = "Bootstrap must not create a combined process before setup."
  }
  assert {
    condition = (
      length(data.azurerm_client_config.deployment) == 0 &&
      length(azurerm_role_assignment.deployment_storage) == 0
    )
    error_message = "Deployment Blob access must remain opt-in without reading or granting a deployment principal by default."
  }
  assert {
    condition = (
      output.installation.app_id == null &&
      output.installation.resource_group_id == azurerm_resource_group.hub.id &&
      output.installation.resource_group_id == "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub" &&
      output.installation.storage_account_id == azurerm_storage_account.artifacts.id &&
      output.installation.storage_account_id == "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.Storage/storageAccounts/testhub"
    )
    error_message = "Bootstrap coordinates must expose authoritative group and storage IDs without claiming a deployed app."
  }
  assert {
    condition = (
      azurerm_container_app_job.setup.template[0].container[0].command == tolist(["node", "dist/server/scripts/azure-entrypoint/index.js", "setup"]) &&
      azurerm_container_app_job.setup.manual_trigger_config[0].parallelism == 1 &&
      azurerm_container_app_job.setup.replica_retry_limit == 0
    )
    error_message = "Setup must run explicitly, once per execution, without automatic retries."
  }
}

run "deployment_blob_access_is_an_explicit_account_scoped_grant" {
  command = plan

  variables {
    grant_deployment_storage_access = true
  }

  assert {
    condition = (
      length(data.azurerm_client_config.deployment) == 1 &&
      length(azurerm_role_assignment.deployment_storage) == 1 &&
      azurerm_role_assignment.deployment_storage[0].scope == azurerm_storage_account.artifacts.id &&
      azurerm_role_assignment.deployment_storage[0].role_definition_name == "Storage Blob Data Contributor" &&
      azurerm_role_assignment.deployment_storage[0].principal_id == data.azurerm_client_config.deployment[0].object_id &&
      azurerm_role_assignment.deployment_storage[0].principal_id == "00000000-0000-0000-0000-000000000005" &&
      azurerm_role_assignment.deployment_storage[0].principal_id != azurerm_user_assigned_identity.hub.principal_id &&
      azurerm_role_assignment.deployment_storage[0].principal_id != azurerm_user_assigned_identity.setup.principal_id
    )
    error_message = "Opt-in Blob access must grant only the authenticated deployment principal on the installation storage account, not a workload or the artifacts container."
  }
}

run "durable_state_requires_private_authenticated_access" {
  command = plan

  assert {
    condition = (
      !azurerm_postgresql_flexible_server.database.public_network_access_enabled &&
      azurerm_postgresql_flexible_server_configuration.tls.value == "on" &&
      azurerm_postgresql_flexible_server.database.backup_retention_days >= 7
    )
    error_message = "PostgreSQL must be private, TLS-only, and retain recoverable backups."
  }
  assert {
    condition     = contains(coalesce(azurerm_subnet.database.service_endpoints, []), "Microsoft.Storage")
    error_message = "The database subnet must retain Microsoft.Storage for PostgreSQL WAL archival."
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
      output.installation.app_id == azurerm_container_app.hub[0].id &&
      output.installation.app_id == "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/containerApps/test-hub-hub"
    )
    error_message = "A deployed app must expose its actual Azure resource ID for the deployment report."
  }
  assert {
    condition = (
      azurerm_container_app.hub[0].template[0].min_replicas == 1 &&
      azurerm_container_app.hub[0].template[0].max_replicas == 1 &&
      azurerm_container_app.hub[0].revision_mode == "Multiple" &&
      azurerm_container_app.hub[0].template[0].termination_grace_period_seconds >= 35 &&
      azurerm_container_app.hub[0].template[0].termination_grace_period_seconds <= 60 &&
      azurerm_container_app.hub[0].template[0].container[0].command == tolist(["node", "dist/server/scripts/azure-entrypoint/index.js", "runtime"]) &&
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
  assert {
    condition = toset([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.name]) == toset([
      "NODE_ENV", "RUNTIME_MODE", "HOST", "PORT", "CLIENT_DIRECTORY", "SHUTDOWN_TIMEOUT_MS",
      "ARTIFACT_STORAGE_PROVIDER", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER",
      "AZURE_CLIENT_ID", "AZURE_KEY_VAULT_SECRET_REFERENCES",
    ])
    error_message = "Omitting optional runtime configuration must leave the deployment-owned environment unchanged."
  }
}

run "setup_and_runtime_have_separate_secret_access" {
  command = plan

  variables {
    deploy_hub = true
    acr_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/existing/providers/Microsoft.ContainerRegistry/registries/existing"
    runtime_secret_references = {
      SERVICE_API_KEY = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = "https://service.vault.azure.net/secrets/api-key/cccccccccccccccccccccccccccccccc"
      }
    }
    runtime_environment_variables = merge(
      { for index in range(61) : "PUBLIC_${index}" => "public" },
      {
        GITHUB_CLIENT_ID                           = "synthetic-public-client"
        HUB_APPLICATION_ORIGIN                     = "https://hub.example.com"
        EMPTY_SETTING                              = ""
        "A${join("", [for i in range(40) : "B"])}" = "maximum-length-name"
      },
    )
  }

  assert {
    condition = (
      azurerm_user_assigned_identity.hub.principal_id != azurerm_user_assigned_identity.setup.principal_id &&
      azurerm_container_app.hub[0].identity[0].identity_ids == toset([azurerm_user_assigned_identity.hub.id]) &&
      azurerm_container_app_job.setup.identity[0].identity_ids == toset([azurerm_user_assigned_identity.setup.id]) &&
      azurerm_role_assignment.artifacts.principal_id == azurerm_user_assigned_identity.hub.principal_id &&
      azurerm_role_assignment.image_pull[0].principal_id == azurerm_user_assigned_identity.hub.principal_id &&
      azurerm_role_assignment.setup_image_pull[0].principal_id == azurerm_user_assigned_identity.setup.principal_id &&
      azurerm_role_assignment.setup_image_pull[0].scope == var.acr_id &&
      azurerm_role_assignment.setup_image_pull[0].role_definition_name == "AcrPull"
    )
    error_message = "Setup and Hub need separate identities; only Hub receives artifact access and each pulls its own image."
  }
  assert {
    condition = (
      toset([for grant in azurerm_role_assignment.runtime_secrets : grant.scope]) == toset([
        "${var.runtime_database_secret.key_vault_id}/secrets/runtime-database",
        "${var.runtime_secret_references.SERVICE_API_KEY.key_vault_id}/secrets/api-key",
      ]) &&
      alltrue([for grant in azurerm_role_assignment.runtime_secrets :
        grant.principal_id == azurerm_user_assigned_identity.hub.principal_id &&
        grant.role_definition_name == "Key Vault Secrets User"
      ]) &&
      azurerm_role_assignment.setup_secrets.scope == "${var.setup_database_secret.key_vault_id}/secrets/setup-database" &&
      azurerm_role_assignment.setup_secrets.principal_id == azurerm_user_assigned_identity.setup.principal_id &&
      azurerm_role_assignment.setup_secrets.role_definition_name == "Key Vault Secrets User"
    )
    error_message = "Each identity may read only its own individual secrets, even when database secrets share a vault."
  }
  assert {
    condition = (
      length(azurerm_container_app.hub[0].secret) == 0 &&
      length(azurerm_container_app_job.setup.secret) == 0 &&
      alltrue([for env in azurerm_container_app.hub[0].template[0].container[0].env :
        (env.secret_name == null || env.secret_name == "") &&
        !contains(["DATABASE_URL", "SERVICE_API_KEY", "HUB_MIGRATION_PASSWORD", "HUB_RUNTIME_PASSWORD"], env.name)
      ]) &&
      alltrue([for env in azurerm_container_app_job.setup.template[0].container[0].env :
        env.secret_name == null || env.secret_name == ""
      ]) &&
      one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "AZURE_CLIENT_ID"]) == azurerm_user_assigned_identity.hub.client_id &&
      one([for env in azurerm_container_app_job.setup.template[0].container[0].env : env.value if env.name == "AZURE_CLIENT_ID"]) == azurerm_user_assigned_identity.setup.client_id &&
      tomap(jsondecode(one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"]))) == tomap({
        DATABASE_URL    = var.runtime_database_secret.secret_id
        SERVICE_API_KEY = var.runtime_secret_references.SERVICE_API_KEY.secret_id
      }) &&
      tomap(jsondecode(one([for env in azurerm_container_app_job.setup.template[0].container[0].env : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"]))) == tomap({
        DATABASE_URL = var.setup_database_secret.secret_id
      })
    )
    error_message = "Each container must receive only its explicit identity and URI-only startup metadata, without platform secrets, secret-name bindings, or resolved secret values."
  }
  assert {
    condition = (
      toset([for env in azurerm_container_app_job.setup.template[0].container[0].env : env.name]) == toset([
        "NODE_ENV", "RUNTIME_MODE", "DATABASE_RUNTIME_ROLE", "AZURE_CLIENT_ID", "AZURE_KEY_VAULT_SECRET_REFERENCES",
      ]) &&
      alltrue([for name, value in {
        NODE_ENV              = "production"
        RUNTIME_MODE          = "setup"
        DATABASE_RUNTIME_ROLE = "replica_runtime"
        } : one([for env in azurerm_container_app_job.setup.template[0].container[0].env : env.value if env.name == name]) == value
      ])
    )
    error_message = "Setup must receive only production/setup mode, its identity and migration URI metadata, and the fixed runtime grant target."
  }
  assert {
    condition = (
      length(azurerm_container_app.hub[0].template[0].container[0].env) == 11 + length(var.runtime_environment_variables) &&
      alltrue([for name, value in merge(var.runtime_environment_variables, {
        NODE_ENV                  = "production"
        RUNTIME_MODE              = "combined"
        HOST                      = "0.0.0.0"
        PORT                      = "3001"
        CLIENT_DIRECTORY          = "/app/dist/client"
        SHUTDOWN_TIMEOUT_MS       = "30000"
        ARTIFACT_STORAGE_PROVIDER = "azure"
        AZURE_STORAGE_ACCOUNT     = azurerm_storage_account.artifacts.name
        AZURE_STORAGE_CONTAINER   = "artifacts"
        }) : one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == name]) == value
      ])
    )
    error_message = "Public settings, empty strings, and maximum-length names must reach only Hub without a secret-reference count cap or changes to deployment-owned values."
  }
}

run "runtime_environment_rejects_reserved_names" {
  command = plan
  variables {
    runtime_environment_variables = { PORT = "9000" }
  }
  expect_failures = [var.runtime_environment_variables]
}

run "runtime_environment_rejects_invalid_names" {
  command = plan
  variables {
    runtime_environment_variables = { github_client_id = "synthetic-public-client" }
  }
  expect_failures = [var.runtime_environment_variables]
}

run "runtime_environment_rejects_oversized_names" {
  command = plan
  variables {
    runtime_environment_variables = {
      "${join("", [for i in range(42) : "A"])}" = "synthetic-public-value"
    }
  }
  expect_failures = [var.runtime_environment_variables]
}

run "runtime_environment_rejects_null_values" {
  command = plan
  variables {
    runtime_environment_variables = { PUBLIC_SETTING = null }
  }
  expect_failures = [var.runtime_environment_variables]
}

run "runtime_environment_cannot_duplicate_a_secret_reference" {
  command = plan
  variables {
    runtime_environment_variables = {
      SERVICE_API_KEY = "https://service.vault.azure.net/secrets/api-key"
    }
    runtime_secret_references = {
      SERVICE_API_KEY = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = "https://service.vault.azure.net/secrets/api-key"
      }
    }
  }
  expect_failures = [var.runtime_environment_variables]
}

run "mutable_image_is_rejected" {
  command = plan
  variables {
    image = "example.azurecr.io/hub:latest"
  }
  expect_failures = [var.image]
}

run "runtime_cannot_receive_the_migration_secret" {
  command = plan
  variables {
    runtime_secret_references = {
      EXTRA_DATABASE_URL = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
        secret_id    = "https://database.vault.azure.net/secrets/setup-database"
      }
    }
  }
  expect_failures = [var.runtime_secret_references]
}

run "runtime_cannot_override_azure_secret_metadata" {
  command = plan
  variables {
    runtime_secret_references = {
      AZURE_KEY_VAULT_SECRET_REFERENCES = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = "https://service.vault.azure.net/secrets/metadata-override/cccccccccccccccccccccccccccccccc"
      }
    }
  }
  expect_failures = [var.runtime_secret_references]
}

run "runtime_cannot_override_the_managed_identity" {
  command = plan
  variables {
    runtime_secret_references = {
      AZURE_CLIENT_ID = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = "https://service.vault.azure.net/secrets/identity-override/cccccccccccccccccccccccccccccccc"
      }
    }
  }
  expect_failures = [var.runtime_secret_references]
}

run "runtime_reference_limit_includes_database_url" {
  command = plan
  variables {
    deploy_hub = true
    acr_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/existing/providers/Microsoft.ContainerRegistry/registries/existing"
    runtime_secret_references = {
      for index in range(63) : format("SERVICE_%02d", index) => {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = format("https://service.vault.azure.net/secrets/service-%02d", index)
      }
    }
  }

  assert {
    condition = length(jsondecode(one([
      for env in azurerm_container_app.hub[0].template[0].container[0].env
      : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
    ]))) == 64
    error_message = "The runtime's 64-reference limit includes DATABASE_URL and allows at most 63 optional references."
  }
}

run "runtime_rejects_64_optional_references" {
  command = plan
  variables {
    runtime_secret_references = {
      for index in range(64) : format("SERVICE_%02d", index) => {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = format("https://service.vault.azure.net/secrets/service-%02d", index)
      }
    }
  }
  expect_failures = [var.runtime_secret_references]
}

run "maximum_length_secret_references_fit_runtime_metadata" {
  command = plan
  variables {
    deploy_hub = true
    acr_id     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/existing/providers/Microsoft.ContainerRegistry/registries/existing"
    runtime_database_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvv"
      secret_id    = "https://vvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/${join("", [for i in range(127) : "a"])}/${join("", [for i in range(32) : "a"])}"
    }
    setup_database_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvv"
      secret_id    = "https://vvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/${join("", [for i in range(127) : "b"])}/${join("", [for i in range(32) : "b"])}"
    }
    runtime_secret_references = {
      for index in range(63) : format("S%02d%s", index, join("", [for i in range(38) : "A"])) => {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvv"
        secret_id    = "https://vvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/${join("", [for i in range(127) : "a"])}/${join("", [for i in range(32) : "a"])}"
      }
    }
  }
  assert {
    condition = (
      length(jsondecode(one([
        for env in azurerm_container_app.hub[0].template[0].container[0].env
        : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
      ]))) == 64 &&
      length(one([
        for env in azurerm_container_app.hub[0].template[0].container[0].env
        : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
      ])) < 65536
    )
    error_message = "Maximum-length references must fit the 64-entry startup metadata limit."
  }
}

run "runtime_reference_rejects_oversized_vault" {
  command = plan
  variables {
    runtime_secret_references = {
      SERVICE_KEY = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvvv"
        secret_id    = "https://vvvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/service"
      }
    }
  }
  expect_failures = [var.runtime_secret_references]
}

run "runtime_reference_rejects_oversized_secret" {
  command = plan
  variables {
    runtime_secret_references = {
      SERVICE_KEY = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/service"
        secret_id    = "https://service.vault.azure.net/secrets/${join("", [for i in range(128) : "s"])}"
      }
    }
  }
  expect_failures = [var.runtime_secret_references]
}

run "runtime_database_rejects_oversized_vault" {
  command = plan
  variables {
    runtime_database_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvvv"
      secret_id    = "https://vvvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/runtime"
    }
  }
  expect_failures = [var.runtime_database_secret]
}

run "runtime_database_rejects_oversized_secret" {
  command = plan
  variables {
    runtime_database_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
      secret_id    = "https://database.vault.azure.net/secrets/${join("", [for i in range(128) : "r"])}"
    }
  }
  expect_failures = [var.runtime_database_secret]
}

run "setup_database_rejects_oversized_vault" {
  command = plan
  variables {
    setup_database_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvvv"
      secret_id    = "https://vvvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/setup"
    }
  }
  expect_failures = [var.setup_database_secret]
}

run "setup_database_rejects_oversized_secret" {
  command = plan
  variables {
    setup_database_secret = {
      key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
      secret_id    = "https://database.vault.azure.net/secrets/${join("", [for i in range(128) : "s"])}"
    }
  }
  expect_failures = [var.setup_database_secret]
}

run "hostname_without_certificate_is_rejected" {
  command = plan
  variables {
    custom_hostname = "hub.example.com"
  }
  expect_failures = [var.certificate_id]
}

run "azure_assigned_resource_state" {
  command   = apply
  state_key = "azure-assigned"

  providers = {
    azurerm = azurerm.rerun
  }

  # Both properties are optional, not computed, so provider mocks cannot populate
  # them. Seed only these resources through a mocked apply, never a state edit.
  module {
    source = "./tests/fixtures/azure-assigned"
  }

  assert {
    condition = (
      azurerm_container_app_environment.hub.infrastructure_resource_group_name == "ME_test-hub-environment_test-hub_eastus2" &&
      azurerm_postgresql_flexible_server.database.zone == "2"
    )
    error_message = "The mock apply must retain Azure-assigned properties before testing a rerun."
  }
}

run "rerun_retains_azure_assigned_resource_properties" {
  command   = plan
  state_key = "azure-assigned"

  providers = {
    azurerm = azurerm.rerun
  }

  assert {
    condition     = azurerm_container_app_environment.hub.infrastructure_resource_group_name == "ME_test-hub-environment_test-hub_eastus2"
    error_message = "Rerunning must retain the Azure-owned infrastructure resource group."
  }
  assert {
    condition     = azurerm_postgresql_flexible_server.database.zone == "2"
    error_message = "Rerunning must retain the Azure-assigned PostgreSQL zone."
  }
}

run "rerun_still_plans_configured_resource_changes" {
  command   = plan
  state_key = "azure-assigned"

  providers = {
    azurerm = azurerm.rerun
  }

  variables {
    owner                 = "new-owning-team"
    postgres_sku          = "B_Standard_B2s"
    backup_retention_days = 21
  }

  assert {
    condition = (
      azurerm_container_app_environment.hub.tags.owner == "new-owning-team" &&
      azurerm_postgresql_flexible_server.database.tags.owner == "new-owning-team" &&
      azurerm_postgresql_flexible_server.database.sku_name == "B_Standard_B2s" &&
      azurerm_postgresql_flexible_server.database.backup_retention_days == 21
    )
    error_message = "Ignoring service-assigned placement must not hide configured resource changes."
  }
}
