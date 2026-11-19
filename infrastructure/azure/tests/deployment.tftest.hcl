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
  mock_resource "azurerm_container_app_job" {
    defaults = {
      id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/jobs/test-job"
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

override_resource {
  target          = azurerm_user_assigned_identity.decision_runtime
  override_during = plan
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/decision-runtime"
    client_id    = "00000000-0000-0000-0000-000000000006"
    principal_id = "00000000-0000-0000-0000-000000000006"
  }
}

override_resource {
  target          = azurerm_user_assigned_identity.decision_inference
  override_during = plan
  values = {
    id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/decision-inference"
    client_id    = "00000000-0000-0000-0000-000000000007"
    principal_id = "00000000-0000-0000-0000-000000000007"
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

run "deployment_blob_access_uses_the_explicit_account_principal" {
  command = plan

  variables {
    grant_deployment_storage_access = true
    deployment_storage_principal_id = "00000000-0000-0000-0000-000000000006"
  }

  assert {
    condition = (
      length(data.azurerm_client_config.deployment) == 0 &&
      length(azurerm_role_assignment.deployment_storage) == 1 &&
      azurerm_role_assignment.deployment_storage[0].scope == azurerm_storage_account.artifacts.id &&
      azurerm_role_assignment.deployment_storage[0].principal_id == "00000000-0000-0000-0000-000000000006"
    )
    error_message = "An explicit deployment principal must receive the one account-scoped grant without reading the current principal."
  }
}

run "invalid_deployment_storage_principal_is_rejected" {
  command = plan

  variables {
    deployment_storage_principal_id = "not-an-object-id"
  }

  expect_failures = [var.deployment_storage_principal_id]
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

run "decision_runtime_uses_private_data_scale_to_zero_gpu_and_split_identities" {
  command = plan

  variables {
    deploy_hub                                   = true
    enable_decision_runtime                      = true
    decision_training_job_id                     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/customer/providers/Microsoft.App/jobs/customer-decision-training"
    decision_training_job_name                   = "customer-decision-training"
    decision_training_principal_id               = "00000000-0000-0000-0000-000000000008"
    decision_training_broker_url                 = "https://decision-broker.example.com"
    decision_training_control_scope              = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/customer/providers/Microsoft.App/containerApps/decision-broker"
    decision_training_control_role_definition_id = "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/00000000-0000-0000-0000-000000000098"
    decision_inference_scope                     = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/customer/providers/Microsoft.MachineLearningServices/workspaces/customer/onlineEndpoints/decision"
    decision_inference_role_definition_id        = "/subscriptions/00000000-0000-0000-0000-000000000000/providers/Microsoft.Authorization/roleDefinitions/00000000-0000-0000-0000-000000000099"
  }

  assert {
    condition = (
      azurerm_storage_container.decision[0].container_access_type == "private" &&
      !azurerm_storage_account.artifacts.shared_access_key_enabled &&
      azurerm_storage_account.artifacts.blob_properties[0].versioning_enabled &&
      azurerm_storage_account.artifacts.blob_properties[0].delete_retention_policy[0].permanent_delete_enabled &&
      azurerm_storage_management_policy.artifacts.rule[0].actions[0].version[0].delete_after_days_since_creation == var.decision_artifact_version_retention_days &&
      azurerm_role_assignment.decision_runtime_artifacts[0].scope == "${azurerm_storage_account.artifacts.id}/blobServices/default/containers/decision-runtime" &&
      azurerm_role_assignment.decision_training_artifacts[0].scope == "${azurerm_storage_account.artifacts.id}/blobServices/default/containers/decision-runtime"
    )
    error_message = "Decision tasksets, candidates, and reports must stay in the private versioned container through identity-based access."
  }
  assert {
    condition = (
      azurerm_role_assignment.decision_training_control[0].scope == var.decision_training_control_scope &&
      azurerm_role_assignment.decision_training_control[0].role_definition_id == var.decision_training_control_role_definition_id &&
      output.installation.decision_training_job_name == var.decision_training_job_name
    )
    error_message = "The reference path must invoke the fixed training job through the customer broker, not direct job operator access."
  }
  assert {
    condition = (
      azurerm_container_app.hub[0].identity[0].identity_ids == toset([
        azurerm_user_assigned_identity.hub.id,
        azurerm_user_assigned_identity.decision_runtime[0].id,
        azurerm_user_assigned_identity.decision_inference[0].id,
      ]) &&
      one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "AZURE_DECISION_TRAINING_BROKER"]) == var.decision_training_broker_url &&
      one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "AZURE_DECISION_TRAINING_JOB"]) == var.decision_training_job_name
    )
    error_message = "Hub must receive the split identities and fixed training broker coordinates."
  }
  assert {
    condition = (
      azurerm_user_assigned_identity.decision_runtime[0].principal_id != var.decision_training_principal_id &&
      azurerm_user_assigned_identity.decision_runtime[0].principal_id != azurerm_user_assigned_identity.decision_inference[0].principal_id &&
      azurerm_role_assignment.decision_training_control[0].principal_id == azurerm_user_assigned_identity.decision_runtime[0].principal_id &&
      azurerm_role_assignment.decision_training_artifacts[0].principal_id == var.decision_training_principal_id &&
      azurerm_role_assignment.decision_inference[0].principal_id == azurerm_user_assigned_identity.decision_inference[0].principal_id &&
      azurerm_role_assignment.decision_inference[0].role_definition_id == var.decision_inference_role_definition_id
    )
    error_message = "Runtime orchestration, GPU execution, and inference need separate least-privilege managed identities."
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

run "runtime_environment_rejects_reserved_credential_names" {
  command = plan
  variables {
    runtime_environment_variables = { AZURE_KEY_VAULT_SECRET_REFERENCES = "synthetic-value" }
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

run "runtime_environment_rejects_credential_names" {
  command = plan
  variables {
    runtime_environment_variables = { REPLICA_COPILOT_TOKEN = "synthetic-value" }
  }
  expect_failures = [var.runtime_environment_variables]
}

run "runtime_environment_accepts_credential_words_inside_other_words" {
  command = plan
  variables {
    runtime_environment_variables = { MONKEY_MODE = "on", TOKENIZER = "basic" }
  }
}

run "runtime_environment_cannot_duplicate_a_secret_reference" {
  command = plan
  variables {
    runtime_environment_variables = {
      SERVICE_ENDPOINT = "https://service.vault.azure.net/secrets/api-key"
    }
    runtime_secret_references = {
      SERVICE_ENDPOINT = {
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

run "bootstrap_requires_a_postgres_administrator_password" {
  command = plan

  variables {
    postgres_admin_password = null
  }

  expect_failures = [azurerm_postgresql_flexible_server.database]
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

run "release_reuses_the_existing_postgres_administrator_password" {
  command   = plan
  state_key = "azure-assigned"

  providers = {
    azurerm = azurerm.rerun
  }

  variables {
    postgres_admin_password                = null
    reuse_existing_postgres_admin_password = true
  }

  assert {
    condition     = azurerm_postgresql_flexible_server.database.administrator_password == "NotARealPassword-12345"
    error_message = "A release without the password must retain the administrator password already stored in state."
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

run "github_app_combines_named_settings_generic_values_and_startup_secret_references" {
  command = plan

  variables {
    deploy_hub                 = true
    hub_application_origin     = "https://hub.example.com"
    github_app_id              = "123456"
    github_client_id           = "Iv23liExampleClient"
    github_app_installation_id = "7890123"
    github_provider_revision   = 2
    runtime_environment_variables = {
      PUBLIC_SETTING = "public"
    }
    runtime_secret_references = {
      GITHUB_CLIENT_SECRET = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-client-secret/11111111111111111111111111111111"
      }
      GITHUB_APP_PRIVATE_KEY_BASE64 = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-app-private-key/22222222222222222222222222222222"
      }
      GITHUB_WEBHOOK_SECRET = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-webhook-secret/33333333333333333333333333333333"
      }
      HUB_AUTHENTICATION_ENCRYPTION_KEY = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/hub-authentication-encryption-key/44444444444444444444444444444444"
      }
      HUB_BOOTSTRAP_SECRET = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/hub-bootstrap-secret/55555555555555555555555555555555"
      }
    }
  }

  assert {
    condition = alltrue([for name, value in {
      HUB_APPLICATION_ORIGIN     = "https://hub.example.com"
      GITHUB_APP_ID              = "123456"
      GITHUB_CLIENT_ID           = "Iv23liExampleClient"
      GITHUB_APP_INSTALLATION_ID = "7890123"
      GITHUB_PROVIDER_REVISION   = "2"
      PUBLIC_SETTING             = "public"
      } : one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == name]) == value
    ])
    error_message = "Named GitHub settings and generic public values must reach Hub together, with the provider revision serialized as a string."
  }
  assert {
    condition = (
      length(azurerm_container_app.hub[0].secret) == 0 &&
      alltrue([for env in azurerm_container_app.hub[0].template[0].container[0].env :
        (env.secret_name == null || env.secret_name == "") &&
        !contains(concat(["DATABASE_URL"], keys(var.runtime_secret_references)), env.name)
      ]) &&
      one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "AZURE_CLIENT_ID"]) == azurerm_user_assigned_identity.hub.client_id &&
      tomap(jsondecode(one([
        for env in azurerm_container_app.hub[0].template[0].container[0].env
        : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
        ]))) == tomap(merge(
        { DATABASE_URL = var.runtime_database_secret.secret_id },
        { for name, reference in var.runtime_secret_references : name => reference.secret_id },
      ))
    )
    error_message = "GitHub and authentication secrets must reach the managed-identity startup loader as URI-only metadata, without platform secrets or direct secret environment bindings."
  }
  assert {
    condition = (
      toset([for grant in azurerm_role_assignment.runtime_secrets : grant.scope]) == toset(concat(
        ["${var.runtime_database_secret.key_vault_id}/secrets/runtime-database"],
        [for name in ["github-client-secret", "github-app-private-key", "github-webhook-secret", "hub-authentication-encryption-key", "hub-bootstrap-secret"] :
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github/secrets/${name}"]
      )) &&
      alltrue([for grant in azurerm_role_assignment.runtime_secrets :
        grant.principal_id == azurerm_user_assigned_identity.hub.principal_id &&
        grant.role_definition_name == "Key Vault Secrets User"
      ])
    )
    error_message = "Hub may read only the individual GitHub App and authentication secrets it references, not the whole vault."
  }
}

run "named_github_authentication_requires_an_explicit_origin" {
  command = plan

  variables {
    deploy_hub       = true
    github_client_id = "synthetic-client"
  }

  expect_failures = [azurerm_container_app.hub]
}

run "generic_github_authentication_requires_an_explicit_origin" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = "synthetic-client"
    }
  }

  expect_failures = [azurerm_container_app.hub]
}

run "entra_authentication_requires_an_explicit_origin" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      ENTRA_OIDC_CLIENT_ID = "synthetic-client"
    }
  }

  expect_failures = [azurerm_container_app.hub]
}

run "local_sign_in_requires_an_explicit_origin" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      HUB_LOCAL_SIGN_IN = "true"
    }
  }

  expect_failures = [azurerm_container_app.hub]
}

run "shared_authentication_secret_requires_an_explicit_origin" {
  command = plan

  variables {
    deploy_hub = true
    runtime_secret_references = {
      HUB_BOOTSTRAP_SECRET = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/bootstrap"
      }
    }
  }

  expect_failures = [azurerm_container_app.hub]
}

run "authentication_accepts_a_secret_referenced_origin" {
  command = plan

  variables {
    deploy_hub       = true
    github_client_id = "synthetic-client"
    runtime_secret_references = {
      HUB_APPLICATION_ORIGIN = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/hub-origin/11111111111111111111111111111111"
      }
    }
  }

  assert {
    condition = jsondecode(one([
      for env in azurerm_container_app.hub[0].template[0].container[0].env
      : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
    ])).HUB_APPLICATION_ORIGIN == var.runtime_secret_references.HUB_APPLICATION_ORIGIN.secret_id
    error_message = "The explicitly referenced origin must reach Hub's startup secret loader."
  }
}

run "github_settings_are_omitted_when_unset" {
  command = plan

  variables {
    deploy_hub = true
  }

  assert {
    condition = length([
      for env in azurerm_container_app.hub[0].template[0].container[0].env : env.name if startswith(env.name, "GITHUB_")
    ]) == 0
    error_message = "Unset GitHub App settings must not reach Hub's environment."
  }
  assert {
    condition = (
      var.hub_application_origin == null &&
      length([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.name if env.name == "HUB_APPLICATION_ORIGIN"]) == 0 &&
      length(azurerm_container_app_custom_domain.hub) == 0 &&
      azurerm_container_app.hub[0].ingress[0].external_enabled &&
      output.installation.url == "https://${azurerm_container_app.hub[0].ingress[0].fqdn}"
    )
    error_message = "An unset origin must leave the default HTTPS hosting and environment unchanged."
  }
}

run "hub_application_origin_retains_a_nondefault_port" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://hub.example.com:8443"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "HUB_APPLICATION_ORIGIN"]) == "https://hub.example.com:8443"
    error_message = "The exact canonical origin, including its non-default port, must reach Hub."
  }
}

run "hub_application_origin_accepts_a_single_label_hostname" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://localhost"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "HUB_APPLICATION_ORIGIN"]) == "https://localhost"
    error_message = "A canonical single-label hostname must remain unchanged."
  }
}

run "hub_application_origin_accepts_ipv6" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://[::1]:65535"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "HUB_APPLICATION_ORIGIN"]) == "https://[::1]:65535"
    error_message = "A canonical IPv6 origin with the highest port must remain unchanged."
  }
}

run "hub_application_origin_accepts_ipv4" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://127.0.0.1:0"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "HUB_APPLICATION_ORIGIN"]) == "https://127.0.0.1:0"
    error_message = "A canonical IPv4 origin with port zero must remain unchanged."
  }
}

run "hub_application_origin_accepts_mapped_ipv6" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://[::ffff:c000:280]"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "HUB_APPLICATION_ORIGIN"]) == "https://[::ffff:c000:280]"
    error_message = "A canonical mapped IPv6 origin must remain unchanged."
  }
}

run "hub_application_origin_accepts_the_maximum_length" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://${join(".", [for i in range(7) : join("", [for j in range(61) : "a"])])}.${join("", [for i in range(58) : "a"])}"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "HUB_APPLICATION_ORIGIN"]) == var.hub_application_origin
    error_message = "A canonical 500-character origin must remain unchanged."
  }
}

run "generic_github_identifiers_satisfy_secret_reference_requirements" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      HUB_APPLICATION_ORIGIN     = "https://hub.example.com"
      GITHUB_APP_ID              = "123456"
      GITHUB_CLIENT_ID           = "Iv23liExampleClient"
      GITHUB_APP_INSTALLATION_ID = "7890123"
      GITHUB_PROVIDER_REVISION   = "2"
    }
    runtime_secret_references = {
      GITHUB_CLIENT_SECRET = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-client-secret"
      }
      GITHUB_APP_PRIVATE_KEY_BASE64 = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-app-private-key"
      }
    }
  }

  assert {
    condition = alltrue([for name, value in var.runtime_environment_variables :
      one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == name]) == value
    ])
    error_message = "Existing generic GitHub settings must remain usable without requiring duplicate named inputs."
  }
  assert {
    condition = tomap(jsondecode(one([
      for env in azurerm_container_app.hub[0].template[0].container[0].env
      : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
      ]))) == tomap(merge(
      { DATABASE_URL = var.runtime_database_secret.secret_id },
      { for name, reference in var.runtime_secret_references : name => reference.secret_id },
    ))
    error_message = "Generic identifiers must satisfy both credential-reference requirements and preserve versionless URIs for startup retrieval."
  }
}

run "named_github_setting_cannot_duplicate_a_generic_value_even_when_equal" {
  command = plan

  variables {
    github_client_id = "Iv23liExampleClient"
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = "Iv23liExampleClient"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "invalid_github_identifiers_are_rejected" {
  command = plan

  variables {
    github_app_id              = "app-123"
    github_client_id           = "Iv23 client"
    github_app_installation_id = "12.5"
    github_provider_revision   = 1.5
  }

  expect_failures = [
    var.github_app_id,
    var.github_client_id,
    var.github_app_installation_id,
    var.github_provider_revision,
  ]
}

run "named_github_settings_accept_their_upper_limits" {
  command = plan

  variables {
    deploy_hub                 = true
    hub_application_origin     = "https://hub.example.com"
    github_app_id              = "9007199254740991"
    github_client_id           = join("", [for i in range(200) : "c"])
    github_app_installation_id = "9007199254740991"
    github_provider_revision   = 2147483647
  }

  assert {
    condition = alltrue([for name, value in {
      GITHUB_APP_ID              = var.github_app_id
      GITHUB_CLIENT_ID           = var.github_client_id
      GITHUB_APP_INSTALLATION_ID = var.github_app_installation_id
      GITHUB_PROVIDER_REVISION   = tostring(var.github_provider_revision)
      } : one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == name]) == value
    ])
    error_message = "Valid upper-bound named GitHub settings must reach Hub unchanged."
  }
}

run "named_client_id_accepts_a_non_ecmascript_whitespace_character" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://hub.example.com"
    github_client_id       = "client\u0085id"
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "GITHUB_CLIENT_ID"]) == var.github_client_id
    error_message = "Client IDs must accept characters that JavaScript does not classify as whitespace."
  }
}

run "generic_client_id_accepts_a_non_ecmascript_whitespace_character" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://hub.example.com"
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = "client\u0085id"
    }
  }

  assert {
    condition     = one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == "GITHUB_CLIENT_ID"]) == var.runtime_environment_variables["GITHUB_CLIENT_ID"]
    error_message = "Generic client IDs must accept characters that JavaScript does not classify as whitespace."
  }
}

run "generic_github_settings_accept_their_upper_limits" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      HUB_APPLICATION_ORIGIN     = "https://hub.example.com"
      GITHUB_APP_ID              = "9007199254740991"
      GITHUB_CLIENT_ID           = join("", [for i in range(200) : "c"])
      GITHUB_APP_INSTALLATION_ID = "9007199254740991"
      GITHUB_PROVIDER_REVISION   = "2147483647"
    }
  }

  assert {
    condition = alltrue([for name, value in var.runtime_environment_variables :
      one([for env in azurerm_container_app.hub[0].template[0].container[0].env : env.value if env.name == name]) == value
    ])
    error_message = "Valid upper-bound generic GitHub settings must reach Hub unchanged."
  }
}

run "named_client_id_accepts_200_utf16_code_units" {
  command = plan

  variables {
    deploy_hub             = true
    hub_application_origin = "https://hub.example.com"
    github_client_id       = join("", [for i in range(100) : "🔑"])
  }

  assert {
    condition = one([
      for env in azurerm_container_app.hub[0].template[0].container[0].env
      : env.value if env.name == "GITHUB_CLIENT_ID"
    ]) == var.github_client_id
    error_message = "A non-whitespace client ID at Hub's UTF-16 length limit must be retained."
  }
}

run "generic_client_id_accepts_200_utf16_code_units" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      HUB_APPLICATION_ORIGIN = "https://hub.example.com"
      GITHUB_CLIENT_ID       = join("", [for i in range(100) : "🔑"])
    }
  }

  assert {
    condition = one([
      for env in azurerm_container_app.hub[0].template[0].container[0].env
      : env.value if env.name == "GITHUB_CLIENT_ID"
    ]) == var.runtime_environment_variables.GITHUB_CLIENT_ID
    error_message = "A generic client ID at Hub's UTF-16 length limit must be retained."
  }
}

run "named_github_settings_reject_values_above_their_limits" {
  command = plan

  variables {
    hub_application_origin     = "https://hub.example.com"
    github_app_id              = "9007199254740992"
    github_client_id           = join("", [for i in range(201) : "c"])
    github_app_installation_id = "9007199254740992"
    github_provider_revision   = 2147483648
  }

  expect_failures = [
    var.github_app_id,
    var.github_client_id,
    var.github_app_installation_id,
    var.github_provider_revision,
  ]
}

run "named_github_settings_reject_empty_and_non_positive_values" {
  command = plan

  variables {
    github_app_id              = "0"
    github_client_id           = ""
    github_app_installation_id = "0"
    github_provider_revision   = 0
  }

  expect_failures = [
    var.github_app_id,
    var.github_client_id,
    var.github_app_installation_id,
    var.github_provider_revision,
  ]
}

run "named_client_id_rejects_non_ascii_whitespace" {
  command = plan

  variables {
    github_client_id = "client\u00a0id"
  }

  expect_failures = [var.github_client_id]
}

run "named_client_id_rejects_a_byte_order_mark" {
  command = plan

  variables {
    github_client_id = "client\ufeffid"
  }

  expect_failures = [var.github_client_id]
}

run "generic_client_id_rejects_non_ascii_whitespace" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = "client\u00a0id"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_client_id_rejects_a_byte_order_mark" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = "client\ufeffid"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "named_client_id_rejects_more_than_200_utf16_code_units" {
  command = plan

  variables {
    github_client_id = join("", [for i in range(101) : "🔑"])
  }

  expect_failures = [var.github_client_id]
}

run "generic_client_id_rejects_more_than_200_utf16_code_units" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = join("", [for i in range(101) : "🔑"])
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_app_id_rejects_an_unsafe_integer" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_APP_ID = "9007199254740992"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_app_id_rejects_zero" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_APP_ID = "0"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_installation_id_rejects_an_unsafe_integer" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_APP_INSTALLATION_ID = "9007199254740992"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_installation_id_rejects_zero" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_APP_INSTALLATION_ID = "0"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_client_id_rejects_more_than_200_characters" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = join("", [for i in range(201) : "c"])
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_client_id_rejects_whitespace" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_CLIENT_ID = "client id"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_provider_revision_rejects_postgresql_overflow" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_PROVIDER_REVISION = "2147483648"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_provider_revision_rejects_zero" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_PROVIDER_REVISION = "0"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_provider_revision_rejects_a_fraction" {
  command = plan

  variables {
    runtime_environment_variables = {
      GITHUB_PROVIDER_REVISION = "1.5"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_origin_must_be_an_exact_https_origin_for_authentication" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      GITHUB_CLIENT_ID       = "synthetic-client"
      HUB_APPLICATION_ORIGIN = "https://hub.example.com/"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "generic_origin_rejects_http" {
  command = plan

  variables {
    deploy_hub = true
    runtime_environment_variables = {
      GITHUB_CLIENT_ID       = "synthetic-client"
      HUB_APPLICATION_ORIGIN = "http://hub.example.com"
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "non_positive_github_provider_revision_is_rejected" {
  command = plan

  variables {
    github_provider_revision = 0
  }

  expect_failures = [var.github_provider_revision]
}

run "github_secrets_require_their_identifiers" {
  command = plan

  variables {
    runtime_secret_references = {
      GITHUB_APP_PRIVATE_KEY_BASE64 = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-app-private-key/22222222222222222222222222222222"
      }
    }
  }

  expect_failures = [var.runtime_environment_variables]
}

run "plain_github_settings_cannot_be_secret_references" {
  command = plan

  variables {
    runtime_secret_references = {
      GITHUB_APP_ID = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-app-id/11111111111111111111111111111111"
      }
    }
  }

  expect_failures = [var.runtime_secret_references]
}

run "empty_github_client_id_is_rejected" {
  command = plan

  variables {
    github_client_id = ""
  }

  expect_failures = [var.github_client_id]
}

run "invalid_hub_application_origin_is_rejected" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com/"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_an_origin_longer_than_the_maximum" {
  command = plan

  variables {
    hub_application_origin = "https://${join(".", [for i in range(7) : join("", [for j in range(61) : "a"])])}.${join("", [for i in range(59) : "a"])}"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_dotted_mapped_ipv6_address" {
  command = plan

  variables {
    hub_application_origin = "https://[::ffff:192.0.2.128]"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_an_uppercase_host" {
  command = plan

  variables {
    hub_application_origin = "https://HUB.example.com"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_shortened_ipv4_address" {
  command = plan

  variables {
    hub_application_origin = "https://127.1"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_an_explicit_default_port" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com:443"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_zero_padded_port" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com:08443"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_non_numeric_port" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com:not-a-port"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_an_out_of_range_port" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com:65536"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_path" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com/path"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_query" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com?synthetic-query"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_a_fragment" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com#synthetic-fragment"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_credentials" {
  command = plan

  variables {
    hub_application_origin = "https://synthetic-user:synthetic-password@hub.example.com"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_rejects_http" {
  command = plan

  variables {
    hub_application_origin = "http://hub.example.com"
  }

  expect_failures = [var.hub_application_origin]
}

run "hub_application_origin_cannot_be_set_twice" {
  command = plan

  variables {
    hub_application_origin = "https://hub.example.com"
    runtime_secret_references = {
      HUB_APPLICATION_ORIGIN = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/hub-origin/11111111111111111111111111111111"
      }
    }
  }

  expect_failures = [var.hub_application_origin]
}

run "copilot_only_github_app_key_requires_only_the_app_id" {
  command = plan

  variables {
    deploy_hub    = true
    github_app_id = "123456"
    runtime_environment_variables = {
      REPLICA_COPILOT_AUTHENTICATION         = "github-app-installation"
      REPLICA_COPILOT_GITHUB_INSTALLATION_ID = "7890123"
    }
    runtime_secret_references = {
      GITHUB_APP_PRIVATE_KEY_BASE64 = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-app-private-key"
      }
    }
  }
}

run "copilot_github_app_key_with_a_webhook_requires_all_identifiers" {
  command = plan

  variables {
    github_app_id = "123456"
    runtime_environment_variables = {
      REPLICA_COPILOT_AUTHENTICATION = "github-app-installation"
    }
    runtime_secret_references = {
      GITHUB_APP_PRIVATE_KEY_BASE64 = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-app-private-key"
      }
      GITHUB_WEBHOOK_SECRET = {
        key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/github"
        secret_id    = "https://github.vault.azure.net/secrets/github-webhook-secret"
      }
    }
  }

  expect_failures = [var.runtime_environment_variables]
}
