locals {
  tags = {
    application  = "replica-hub"
    installation = var.name
    owner        = var.owner
    managed_by   = "terraform"
  }
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
  runtime_secret_scopes = toset([
    for secret in concat([var.runtime_database_secret], values(var.runtime_secret_references)) :
    "${secret.key_vault_id}/secrets/${split("/", secret.secret_id)[4]}"
  ])
}

resource "azurerm_resource_group" "hub" {
  name     = "${var.name}-hub"
  location = var.location
  tags     = local.tags
}

resource "azurerm_virtual_network" "hub" {
  name                = "${var.name}-network"
  location            = var.location
  resource_group_name = azurerm_resource_group.hub.name
  address_space       = ["10.40.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "apps" {
  name                 = "container-apps"
  resource_group_name  = azurerm_resource_group.hub.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.40.0.0/23"]
  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "database" {
  name                 = "postgresql"
  resource_group_name  = azurerm_resource_group.hub.name
  virtual_network_name = azurerm_virtual_network.hub.name
  address_prefixes     = ["10.40.2.0/24"]
  delegation {
    name = "postgresql"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_private_dns_zone" "database" {
  name                = "${var.name}.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.hub.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "database" {
  name                  = "hub"
  resource_group_name   = azurerm_resource_group.hub.name
  private_dns_zone_name = azurerm_private_dns_zone.database.name
  virtual_network_id    = azurerm_virtual_network.hub.id
  tags                  = local.tags
}

resource "azurerm_postgresql_flexible_server" "database" {
  name                          = "${var.name}-postgres"
  resource_group_name           = azurerm_resource_group.hub.name
  location                      = var.location
  version                       = var.postgres_version
  administrator_login           = "replicaadmin"
  administrator_password        = var.postgres_admin_password
  sku_name                      = var.postgres_sku
  storage_mb                    = 32768
  backup_retention_days         = var.backup_retention_days
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = false
  delegated_subnet_id           = azurerm_subnet.database.id
  private_dns_zone_id           = azurerm_private_dns_zone.database.id
  tags                          = local.tags
  depends_on                    = [azurerm_private_dns_zone_virtual_network_link.database]
}

resource "azurerm_postgresql_flexible_server_configuration" "tls" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.database.id
  value     = "on"
}

resource "azurerm_postgresql_flexible_server_database" "hub" {
  name      = "replica"
  server_id = azurerm_postgresql_flexible_server.database.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

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

resource "azurerm_log_analytics_workspace" "hub" {
  name                = "${var.name}-logs"
  resource_group_name = azurerm_resource_group.hub.name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_app_environment" "hub" {
  name                       = "${var.name}-environment"
  resource_group_name        = azurerm_resource_group.hub.name
  location                   = var.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.hub.id
  logs_destination           = "log-analytics"
  infrastructure_subnet_id   = azurerm_subnet.apps.id
  tags                       = local.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
    minimum_count         = 0
    maximum_count         = 0
  }
}
