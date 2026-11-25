locals {
  github_environment = {
    for name, value in {
      HUB_APPLICATION_ORIGIN     = var.hub_application_origin
      GITHUB_APP_ID              = var.github_app_id
      GITHUB_CLIENT_ID           = var.github_client_id
      GITHUB_APP_INSTALLATION_ID = var.github_app_installation_id
      GITHUB_PROVIDER_REVISION   = var.github_provider_revision == null ? null : tostring(var.github_provider_revision)
    } : name => value if value != null
  }

  authentication_environment = merge(var.runtime_environment_variables, local.github_environment)
  copilot_only_github_app = (
    try(trimspace(local.authentication_environment["REPLICA_COPILOT_AUTHENTICATION"]), "") == "github-app-installation" &&
    alltrue([
      for name in ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_PROVIDER_REVISION", "GITHUB_APP_INSTALLATION_ID", "GITHUB_WEBHOOK_SECRET"] :
      try(trimspace(local.authentication_environment[name]), "") == "" &&
      !contains(keys(var.runtime_secret_references), name)
    ])
  )
  authentication_configured = (
    (
      !local.copilot_only_github_app && anytrue([
        for name in ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY_BASE64", "GITHUB_APP_INSTALLATION_ID", "GITHUB_WEBHOOK_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_PROVIDER_REVISION"] :
        try(trimspace(local.authentication_environment[name]), "") != "" ||
        contains(keys(var.runtime_secret_references), name)
      ])
    ) ||
    anytrue([
      for name in ["HUB_AUTHENTICATION_ENCRYPTION_KEY", "HUB_BOOTSTRAP_SECRET", "ENTRA_OIDC_CLIENT_AUTHENTICATION", "ENTRA_OIDC_CLIENT_ID", "ENTRA_OIDC_CLIENT_SECRET", "ENTRA_OIDC_ISSUER", "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID", "ENTRA_OIDC_PROVIDER_REVISION"] :
      try(trimspace(local.authentication_environment[name]), "") != "" ||
      contains(keys(var.runtime_secret_references), name)
    ]) ||
    try(trimspace(local.authentication_environment["HUB_LOCAL_SIGN_IN"]), "") == "true" ||
    contains(keys(var.runtime_secret_references), "HUB_LOCAL_SIGN_IN")
  )
  authentication_origin_supplied = (
    try(trimspace(local.authentication_environment["HUB_APPLICATION_ORIGIN"]), "") != "" ||
    contains(keys(var.runtime_secret_references), "HUB_APPLICATION_ORIGIN")
  )

  runtime_environment = merge({
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
    AZURE_KEY_VAULT_SECRET_REFERENCES = jsonencode(merge(
      { DATABASE_URL = var.runtime_database_secret.secret_id },
      var.learning_database_secret == null ? {} : { REPLICA_LEARNING_DATABASE_URL = var.learning_database_secret.secret_id },
      { for name, reference in var.runtime_secret_references : name => reference.secret_id },
    ))
  }, local.github_environment)
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
      name    = "hub"
      image   = var.image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "dist/server/scripts/azure-entrypoint/index.js", "runtime"]

      dynamic "env" {
        for_each = merge(var.runtime_environment_variables, local.runtime_environment)
        content {
          name  = env.key
          value = env.value
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

    precondition {
      condition     = !local.authentication_configured || local.authentication_origin_supplied
      error_message = "Supply an exact HTTPS HUB_APPLICATION_ORIGIN through hub_application_origin, runtime_environment_variables, or runtime_secret_references when authentication is configured."
    }
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
