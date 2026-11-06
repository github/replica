variable "grant_deployment_storage_access" {
  type        = bool
  default     = false
  description = "Wizard opt-in: grant the Azure CLI deployment identity Blob data access on this installation account."
}

data "azurerm_client_config" "deployment" {
  count = var.grant_deployment_storage_access ? 1 : 0
}

resource "azurerm_role_assignment" "deployment_storage" {
  count                = var.grant_deployment_storage_access ? 1 : 0
  scope                = azurerm_storage_account.artifacts.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = data.azurerm_client_config.deployment[0].object_id
}
