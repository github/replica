terraform {
  required_providers {
    azurerm = {
      source = "hashicorp/azurerm"
    }
  }
}

resource "azurerm_container_app_environment" "hub" {
  name                               = "test-hub-environment"
  resource_group_name                = "test-hub-hub"
  location                           = "eastus2"
  infrastructure_resource_group_name = "ME_test-hub-environment_test-hub_eastus2"
  tags = {
    application  = "replica-hub"
    installation = "test-hub"
    owner        = "test-team"
    managed_by   = "terraform"
  }

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
    minimum_count         = 0
    maximum_count         = 0
  }
}

resource "azurerm_postgresql_flexible_server" "database" {
  name                   = "test-hub-postgres"
  resource_group_name    = "test-hub-hub"
  location               = "eastus2"
  version                = "17"
  administrator_login    = "replicaadmin"
  administrator_password = "NotARealPassword-12345"
  sku_name               = "B_Standard_B1ms"
  storage_mb             = 32768
  backup_retention_days  = 14
  zone                   = "2"
  tags = {
    application  = "replica-hub"
    installation = "test-hub"
    owner        = "test-team"
    managed_by   = "terraform"
  }
}
