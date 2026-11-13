mock_provider "azurerm" {
  override_during = plan
  mock_resource "azurerm_user_assigned_identity" {
    defaults = {
      id           = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.ManagedIdentity/userAssignedIdentities/provision"
      principal_id = "00000000-0000-0000-0000-000000000001"
      client_id    = "00000000-0000-0000-0000-000000000002"
    }
  }
}

variables {
  subscription_id = "00000000-0000-0000-0000-000000000000"
  name            = "test-hub"
  location        = "eastus2"
  resource_group  = "test-hub"
  environment_id  = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-hub/providers/Microsoft.App/managedEnvironments/test"
  image           = "ghcr.io/example/hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  vault_id        = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.KeyVault/vaults/testvault"
  secret_urls = {
    DATABASE_URL           = "https://testvault.vault.azure.net/secrets/postgres-admin-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
  }
}

run "fresh_database_job_is_explicit_and_has_separate_access" {
  command = plan

  variables {
    registry_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.ContainerRegistry/registries/testregistry"
    image       = "testregistry.azurecr.io/replica-hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }

  assert {
    condition = (
      azurerm_container_app_job.provision.replica_retry_limit == 0 &&
      azurerm_container_app_job.provision.manual_trigger_config[0].parallelism == 1 &&
      azurerm_container_app_job.provision.manual_trigger_config[0].replica_completion_count == 1 &&
      azurerm_container_app_job.provision.template[0].container[0].command == tolist(["node", "dist/server/scripts/azure-entrypoint/index.js", "provision"]) &&
      length(azurerm_container_app_job.provision.secret) == 0 &&
      length(azurerm_role_assignment.secrets) == 3 &&
      alltrue([for env in azurerm_container_app_job.provision.template[0].container[0].env :
        env.secret_name == null || env.secret_name == ""
      ])
    )
    error_message = "Fresh provisioning must use its Azure startup wrapper, run once without automatic retries, and never configure platform secrets or secret-name bindings."
  }
  assert {
    condition = (
      length(azurerm_container_app_job.provision.registry) == 1 &&
      one(azurerm_container_app_job.provision.registry).server == "testregistry.azurecr.io" &&
      one(azurerm_container_app_job.provision.registry).identity == azurerm_user_assigned_identity.provision.id &&
      length(azurerm_role_assignment.image) == 1 &&
      alltrue([for grant in azurerm_role_assignment.image :
        grant.scope == var.registry_id &&
        grant.role_definition_name == "AcrPull" &&
        grant.principal_id == azurerm_user_assigned_identity.provision.principal_id
      ])
    )
    error_message = "An explicit ACR needs exactly one registry block and one AcrPull grant for the provisioning identity on that ACR."
  }
  assert {
    condition = (
      azurerm_container_app_job.provision.template[0].container[0].image == var.image &&
      azurerm_container_app_job.provision.identity[0].identity_ids == toset([azurerm_user_assigned_identity.provision.id]) &&
      toset([for grant in azurerm_role_assignment.secrets : grant.scope]) == toset([
        "${var.vault_id}/secrets/postgres-admin-url",
        "${var.vault_id}/secrets/postgres-migration-password",
        "${var.vault_id}/secrets/postgres-runtime-password",
      ]) &&
      alltrue([for grant in azurerm_role_assignment.secrets :
        grant.principal_id == azurerm_user_assigned_identity.provision.principal_id &&
        grant.role_definition_name == "Key Vault Secrets User"
      ]) &&
      toset([for env in azurerm_container_app_job.provision.template[0].container[0].env : env.name]) == toset([
        "NODE_ENV", "AZURE_CLIENT_ID", "AZURE_KEY_VAULT_SECRET_REFERENCES",
      ]) &&
      one([for env in azurerm_container_app_job.provision.template[0].container[0].env : env.value if env.name == "NODE_ENV"]) == "production" &&
      one([for env in azurerm_container_app_job.provision.template[0].container[0].env : env.value if env.name == "AZURE_CLIENT_ID"]) == azurerm_user_assigned_identity.provision.client_id &&
      tomap(jsondecode(one([for env in azurerm_container_app_job.provision.template[0].container[0].env : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"]))) == var.secret_urls
    )
    error_message = "Only the isolated provisioning identity may receive three secret-scoped grants; its container must contain only production mode, its explicit client ID, and the exact URI-only administrator/password map."
  }
}

run "public_digest_needs_no_registry_or_pull_grant" {
  command = plan

  assert {
    condition = (
      var.registry_id == null &&
      length(azurerm_container_app_job.provision.registry) == 0 &&
      length(azurerm_role_assignment.image) == 0 &&
      azurerm_container_app_job.provision.template[0].container[0].image == var.image
    )
    error_message = "A public digest must work with registry_id omitted, without registry authentication or an AcrPull grant."
  }
}

run "matching_vault_names_are_case_insensitive" {
  command = plan

  variables {
    vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.KeyVault/vaults/TESTVAULT"
    secret_urls = {
      DATABASE_URL           = "https://TestVault.vault.azure.net/secrets/postgres-admin-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://TESTVAULT.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
    }
  }

  assert {
    condition = (
      length(azurerm_role_assignment.secrets) == 3 &&
      alltrue([for grant in azurerm_role_assignment.secrets : startswith(grant.scope, "${var.vault_id}/secrets/")]) &&
      tomap(jsondecode(one([for env in azurerm_container_app_job.provision.template[0].container[0].env : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"]))) == var.secret_urls
    )
    error_message = "Matching DNS vault names must be accepted regardless of case, without changing the configured secret references or grant scopes."
  }
}

run "mutable_image_is_rejected" {
  command = plan

  variables {
    image = "ghcr.io/example/hub:latest"
  }

  expect_failures = [var.image]
}

run "all_three_provisioning_secrets_are_required" {
  command = plan

  variables {
    secret_urls = {
      HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
    }
  }

  expect_failures = [var.secret_urls]
}

run "additional_secret_access_is_rejected" {
  command = plan

  variables {
    secret_urls = {
      DATABASE_URL           = "https://testvault.vault.azure.net/secrets/postgres-admin-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
      EXTRA_SECRET           = "https://testvault.vault.azure.net/secrets/extra/dddddddddddddddddddddddddddddddd"
    }
  }

  expect_failures = [var.secret_urls]
}

run "unversioned_secret_is_rejected" {
  command = plan

  variables {
    secret_urls = {
      DATABASE_URL           = "https://testvault.vault.azure.net/secrets/postgres-admin-url"
      HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
    }
  }

  expect_failures = [var.secret_urls]
}

run "malformed_vault_resource_id_is_rejected" {
  command = plan

  variables {
    vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.Storage/storageAccounts/testvault"
  }

  expect_failures = [var.vault_id]
}

run "incomplete_vault_resource_id_is_rejected" {
  command = plan

  variables {
    vault_id = "testvault"
  }

  expect_failures = [var.vault_id]
}

run "secret_hosts_must_match_the_granted_vault" {
  command = plan

  variables {
    secret_urls = {
      DATABASE_URL           = "https://another-vault.vault.azure.net/secrets/postgres-admin-url/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/postgres-migration-password/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/postgres-runtime-password/cccccccccccccccccccccccccccccccc"
    }
  }

  expect_failures = [var.secret_urls]
}

run "maximum_length_secret_urls_are_accepted" {
  command = plan

  variables {
    vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvv"
    secret_urls = {
      DATABASE_URL           = "https://vvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/${join("", [for i in range(127) : "a"])}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      HUB_MIGRATION_PASSWORD = "https://vvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/${join("", [for i in range(127) : "b"])}/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://vvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/${join("", [for i in range(127) : "c"])}/cccccccccccccccccccccccccccccccc"
    }
  }

  assert {
    condition = tomap(jsondecode(one([
      for env in azurerm_container_app_job.provision.template[0].container[0].env
      : env.value if env.name == "AZURE_KEY_VAULT_SECRET_REFERENCES"
    ]))) == var.secret_urls
    error_message = "Provisioning must accept and preserve valid maximum-length secret URLs."
  }
}

run "secret_urls_reject_oversized_vault" {
  command = plan

  variables {
    vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-foundation/providers/Microsoft.KeyVault/vaults/vvvvvvvvvvvvvvvvvvvvvvvvv"
    secret_urls = {
      DATABASE_URL           = "https://vvvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/admin/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      HUB_MIGRATION_PASSWORD = "https://vvvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/migration/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://vvvvvvvvvvvvvvvvvvvvvvvvv.vault.azure.net/secrets/runtime/cccccccccccccccccccccccccccccccc"
    }
  }

  expect_failures = [var.secret_urls]
}

run "secret_urls_reject_oversized_secret" {
  command = plan

  variables {
    secret_urls = {
      DATABASE_URL           = "https://testvault.vault.azure.net/secrets/${join("", [for i in range(128) : "a"])}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      HUB_MIGRATION_PASSWORD = "https://testvault.vault.azure.net/secrets/migration/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      HUB_RUNTIME_PASSWORD   = "https://testvault.vault.azure.net/secrets/runtime/cccccccccccccccccccccccccccccccc"
    }
  }

  expect_failures = [var.secret_urls]
}
