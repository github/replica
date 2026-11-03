resource "azurerm_storage_account" "artifacts" {
  name                            = "${replace(var.name, "-", "")}hub"
  location                        = var.location
  resource_group_name             = azurerm_resource_group.hub.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  tags                            = local.tags

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 14
    }
    container_delete_retention_policy {
      days = 14
    }
  }
}

resource "azurerm_storage_container" "artifacts" {
  name                  = "artifacts"
  storage_account_id    = azurerm_storage_account.artifacts.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "releases" {
  name                  = "releases"
  storage_account_id    = azurerm_storage_account.artifacts.id
  container_access_type = "private"
}

resource "azurerm_storage_blob" "release_lock" {
  name                   = "deployment.lock"
  storage_account_name   = azurerm_storage_account.artifacts.name
  storage_container_name = azurerm_storage_container.releases.name
  type                   = "Block"
  source_content         = "Replica Hub release lock. Do not delete while a release is running.\n"
}
