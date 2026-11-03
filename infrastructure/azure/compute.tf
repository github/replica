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
    name  = "database-url"
    value = local.database_url
  }

  dynamic "secret" {
    for_each = local.secret_names
    content {
      name  = "runtime-${substr(sha256(secret.value), 0, 12)}"
      value = var.runtime_secrets[secret.value]
    }
  }

  template {
    container {
      name    = "setup"
      image   = var.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "dist/server/scripts/setup/index.js"]

      dynamic "env" {
        for_each = merge(local.runtime_environment, { RUNTIME_MODE = "setup" })
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
        for_each = local.secret_names
        content {
          name        = env.value
          secret_name = "runtime-${substr(sha256(env.value), 0, 12)}"
        }
      }
    }
  }

  depends_on = [
    azurerm_postgresql_flexible_server_database.hub,
    azurerm_postgresql_flexible_server_configuration.tls,
    azurerm_role_assignment.artifacts,
    azurerm_role_assignment.image_pull,
  ]
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
    name  = "database-url"
    value = local.database_url
  }

  dynamic "secret" {
    for_each = local.secret_names
    content {
      name  = "runtime-${substr(sha256(secret.value), 0, 12)}"
      value = var.runtime_secrets[secret.value]
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
        for_each = local.secret_names
        content {
          name        = env.value
          secret_name = "runtime-${substr(sha256(env.value), 0, 12)}"
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

  depends_on = [azurerm_container_app_job.setup]
}

resource "azurerm_container_app_custom_domain" "hub" {
  count                                    = var.deploy_hub && var.custom_hostname != null ? 1 : 0
  name                                     = var.custom_hostname
  container_app_id                         = azurerm_container_app.hub[0].id
  container_app_environment_certificate_id = var.certificate_id
  certificate_binding_type                 = "SniEnabled"
}
