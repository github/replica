locals {
  tags = {
    application  = "replica-hub"
    installation = var.name
    owner        = var.owner
    managed_by   = "terraform"
  }
}

resource "azurerm_resource_group" "hub" {
  name     = var.resource_group_name == null ? "${var.name}-hub" : var.resource_group_name
  location = var.location
  tags     = local.tags
}
