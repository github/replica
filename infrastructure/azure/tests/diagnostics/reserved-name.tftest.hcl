mock_provider "azurerm" {}

variables {
  subscription_id         = "00000000-0000-0000-0000-000000000000"
  name                    = "test-hub"
  owner                   = "test-team"
  location                = "eastus2"
  image                   = "example.azurecr.io/hub@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  postgres_admin_password = "NotARealPassword-12345"
  runtime_database_secret = {
    key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
    secret_id    = "https://database.vault.azure.net/secrets/runtime-database/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }
  setup_database_secret = {
    key_vault_id = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/secrets/providers/Microsoft.KeyVault/vaults/database"
    secret_id    = "https://database.vault.azure.net/secrets/setup-database/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}

run "reserved_metadata" {
  command = plan
  variables {
    runtime_environment_variables = { AZURE_KEY_VAULT_SECRET_REFERENCES = "synthetic-value" }
  }
}
