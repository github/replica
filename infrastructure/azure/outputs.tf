output "installation" {
  description = "Non-secret release coordinates; no credentials are emitted."
  value = {
    name                         = var.name
    owner                        = var.owner
    subscription_id              = var.subscription_id
    resource_group               = azurerm_resource_group.hub.name
    resource_group_id            = azurerm_resource_group.hub.id
    app_id                       = var.deploy_hub ? azurerm_container_app.hub[0].id : null
    app_name                     = "${var.name}-hub"
    setup_job_name               = azurerm_container_app_job.setup.name
    storage_account              = azurerm_storage_account.artifacts.name
    storage_account_id           = azurerm_storage_account.artifacts.id
    release_container            = azurerm_storage_container.releases.name
    release_blob                 = azurerm_storage_blob.release_lock.name
    environment_id               = azurerm_container_app_environment.hub.id
    postgres_server_id           = azurerm_postgresql_flexible_server.database.id
    postgres_host                = azurerm_postgresql_flexible_server.database.fqdn
    managed_identity_id          = azurerm_user_assigned_identity.hub.id
    managed_identity_client_id   = azurerm_user_assigned_identity.hub.client_id
    setup_identity_id            = azurerm_user_assigned_identity.setup.id
    decision_storage_container   = var.enable_decision_runtime ? azurerm_storage_container.decision[0].name : null
    decision_training_job_id     = var.enable_decision_runtime ? var.decision_training_job_id : null
    decision_training_job_name   = var.enable_decision_runtime ? var.decision_training_job_name : null
    decision_runtime_client_id   = var.enable_decision_runtime ? azurerm_user_assigned_identity.decision_runtime[0].client_id : null
    decision_inference_client_id = var.enable_decision_runtime ? azurerm_user_assigned_identity.decision_inference[0].client_id : null
    app_created                  = var.deploy_hub
    url                          = var.deploy_hub ? "https://${azurerm_container_app.hub[0].ingress[0].fqdn}" : null
  }
}
