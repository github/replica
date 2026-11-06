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

  lifecycle {
    # Azure names its infrastructure group; resetting that name would replace the environment.
    ignore_changes = [infrastructure_resource_group_name]
  }
}
