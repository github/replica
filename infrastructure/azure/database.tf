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

  lifecycle {
    # Azure selects the zone because this module does not pin one.
    ignore_changes = [zone]
  }
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
