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

resource "azurerm_user_assigned_identity" "decision_runtime" {
  count               = var.enable_decision_runtime ? 1 : 0
  name                = "${var.name}-decision-runtime"
  resource_group_name = azurerm_resource_group.hub.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_user_assigned_identity" "decision_inference" {
  count               = var.enable_decision_runtime ? 1 : 0
  name                = "${var.name}-decision-inference"
  resource_group_name = azurerm_resource_group.hub.name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_role_definition" "decision_artifact_writer" {
  count       = var.enable_decision_runtime ? 1 : 0
  name        = "${var.name}-decision-artifact-writer"
  scope       = azurerm_storage_account.artifacts.id
  description = "Read, create, and write Replica decision artifacts without Blob deletion."

  permissions {
    data_actions = [
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action",
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read",
      "Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write",
    ]
  }

  assignable_scopes = [azurerm_storage_account.artifacts.id]
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

resource "azurerm_role_assignment" "decision_runtime_artifacts" {
  count              = var.enable_decision_runtime ? 1 : 0
  scope              = "${azurerm_storage_account.artifacts.id}/blobServices/default/containers/${azurerm_storage_container.decision[0].name}"
  role_definition_id = azurerm_role_definition.decision_artifact_writer[0].role_definition_resource_id
  principal_id       = azurerm_user_assigned_identity.decision_runtime[0].principal_id
}

resource "azurerm_role_assignment" "decision_training_artifacts" {
  count              = var.enable_decision_runtime ? 1 : 0
  scope              = "${azurerm_storage_account.artifacts.id}/blobServices/default/containers/${azurerm_storage_container.decision[0].name}"
  role_definition_id = azurerm_role_definition.decision_artifact_writer[0].role_definition_resource_id
  principal_id       = var.decision_training_principal_id
}

resource "azurerm_role_assignment" "decision_training_control" {
  count              = var.enable_decision_runtime ? 1 : 0
  scope              = var.decision_training_control_scope
  role_definition_id = var.decision_training_control_role_definition_id
  principal_id       = azurerm_user_assigned_identity.decision_runtime[0].principal_id
}

resource "azurerm_role_assignment" "decision_inference" {
  count              = var.enable_decision_runtime ? 1 : 0
  scope              = var.decision_inference_scope
  role_definition_id = var.decision_inference_role_definition_id
  principal_id       = azurerm_user_assigned_identity.decision_inference[0].principal_id
}
