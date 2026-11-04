resource "azurerm_container_app_job" "setup" {
  name                         = "${var.name}-setup"
  location                     = var.location
  resource_group_name          = azurerm_resource_group.hub.name
  container_app_environment_id = azurerm_container_app_environment.hub.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 1800
  replica_retry_limit          = 0
  tags                         = local.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.setup.id]
  }

  dynamic "registry" {
    for_each = var.acr_id == null ? [] : [var.acr_id]
    content {
      server   = split("/", var.image)[0]
      identity = azurerm_user_assigned_identity.setup.id
    }
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = var.setup_database_secret.secret_id
    identity            = azurerm_user_assigned_identity.setup.id
  }

  template {
    container {
      name    = "setup"
      image   = var.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "dist/server/scripts/setup/index.js"]

      dynamic "env" {
        for_each = {
          NODE_ENV              = "production"
          RUNTIME_MODE          = "setup"
          DATABASE_RUNTIME_ROLE = "replica_runtime"
        }
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
    }
  }

  depends_on = [
    azurerm_postgresql_flexible_server_database.hub,
    azurerm_postgresql_flexible_server_configuration.tls,
    azurerm_role_assignment.setup_secrets,
    azurerm_role_assignment.setup_image_pull,
  ]
}
