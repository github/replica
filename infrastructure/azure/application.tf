locals {
  runtime_environment = {
    NODE_ENV                  = "production"
    RUNTIME_MODE              = "combined"
    HOST                      = "0.0.0.0"
    PORT                      = "3001"
    CLIENT_DIRECTORY          = "/app/dist/client"
    SHUTDOWN_TIMEOUT_MS       = "30000"
    ARTIFACT_STORAGE_PROVIDER = "azure"
    AZURE_STORAGE_ACCOUNT     = azurerm_storage_account.artifacts.name
    AZURE_STORAGE_CONTAINER   = azurerm_storage_container.artifacts.name
    AZURE_CLIENT_ID           = azurerm_user_assigned_identity.hub.client_id
  }
}

resource "azurerm_container_app" "hub" {
  count                        = var.deploy_hub ? 1 : 0
  name                         = "${var.name}-hub"
  resource_group_name          = azurerm_resource_group.hub.name
  container_app_environment_id = azurerm_container_app_environment.hub.id
  workload_profile_name        = "Consumption"
  revision_mode                = "Multiple"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.hub.id]
  }

  dynamic "registry" {
    for_each = var.acr_id == null ? [] : [var.acr_id]
    content {
      server   = split("/", var.image)[0]
      identity = azurerm_user_assigned_identity.hub.id
    }
  }

  secret {
    name                = "database-url"
    key_vault_secret_id = var.runtime_database_secret.secret_id
    identity            = azurerm_user_assigned_identity.hub.id
  }

  dynamic "secret" {
    for_each = var.runtime_secret_references
    content {
      name                = "runtime-${substr(sha256(secret.key), 0, 12)}"
      key_vault_secret_id = secret.value.secret_id
      identity            = azurerm_user_assigned_identity.hub.id
    }
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 3001
    transport                  = "http"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas                     = 1
    max_replicas                     = 1
    termination_grace_period_seconds = 60

    container {
      name   = "hub"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"

      dynamic "env" {
        for_each = local.runtime_environment
        content {
          name  = env.key
          value = env.value
        }
      }

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }

      dynamic "env" {
        for_each = var.runtime_secret_references
        content {
          name        = env.key
          secret_name = "runtime-${substr(sha256(env.key), 0, 12)}"
        }
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 3001
        path                    = "/api/health"
        interval_seconds        = 5
        failure_count_threshold = 30
      }
      readiness_probe {
        transport               = "HTTP"
        port                    = 3001
        path                    = "/api/ready"
        interval_seconds        = 5
        success_count_threshold = 1
        timeout                 = 3
      }
      liveness_probe {
        transport        = "HTTP"
        port             = 3001
        path             = "/api/health"
        interval_seconds = 10
        timeout          = 3
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [
    azurerm_container_app_job.setup,
    azurerm_role_assignment.artifacts,
    azurerm_role_assignment.image_pull,
    azurerm_role_assignment.runtime_secrets,
  ]
}

resource "azurerm_container_app_custom_domain" "hub" {
  count                                    = var.deploy_hub && var.custom_hostname != null ? 1 : 0
  name                                     = var.custom_hostname
  container_app_id                         = azurerm_container_app.hub[0].id
  container_app_environment_certificate_id = var.certificate_id
  certificate_binding_type                 = "SniEnabled"
}
