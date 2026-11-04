locals {
  tags = {
    application  = "replica-hub"
    installation = var.name
    owner        = var.owner
    managed_by   = "terraform"
  }
}

resource "azurerm_resource_group" "hub" {
  name     = "${var.name}-hub"
  location = var.location
  tags     = local.tags
}
