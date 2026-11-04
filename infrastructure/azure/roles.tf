locals {
  runtime_secret_scopes = toset([
    for secret in concat([var.runtime_database_secret], values(var.runtime_secret_references)) :
    "${secret.key_vault_id}/secrets/${split("/", secret.secret_id)[4]}"
  ])
}

resource "azurerm_user_assigned_identity" "hub" {
  name                = "${var.name}-hub"
  resource_group_name = azurerm_resource_group.hub.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_user_assigned_identity" "setup" {
  name                = "${var.name}-setup"
  resource_group_name = azurerm_resource_group.hub.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "runtime_secrets" {
  for_each             = local.runtime_secret_scopes
  scope                = each.value
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.hub.principal_id
}

resource "azurerm_role_assignment" "setup_secrets" {
  scope                = "${var.setup_database_secret.key_vault_id}/secrets/${split("/", var.setup_database_secret.secret_id)[4]}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.setup.principal_id
}

resource "azurerm_role_assignment" "artifacts" {
  scope                = "${azurerm_storage_account.artifacts.id}/blobServices/default/containers/${azurerm_storage_container.artifacts.name}"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.hub.principal_id
}

resource "azurerm_role_assignment" "image_pull" {
  count                = var.acr_id == null ? 0 : 1
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.hub.principal_id
}

resource "azurerm_role_assignment" "setup_image_pull" {
  count                = var.acr_id == null ? 0 : 1
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.setup.principal_id
}
