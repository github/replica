variable "subscription_id" {
  type        = string
  description = "Explicit Azure subscription for this installation."
}

variable "name" {
  type        = string
  description = "Globally unique installation prefix, also used to confirm ownership."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,18}[a-z0-9]$", var.name)) && !strcontains(var.name, "--")
    error_message = "Use 4–20 lowercase letters, digits, or single hyphens, beginning with a letter."
  }
}

variable "location" {
  type        = string
  description = "Azure region supporting Container Apps and PostgreSQL Flexible Server."
}

variable "resource_group_name" {
  type        = string
  default     = null
  description = "Optional dedicated installation resource group name. Existing unmanaged groups are not adopted automatically."
}

variable "owner" {
  type        = string
  description = "Team responsible for cost, releases, and recovery."

  validation {
    condition     = length(trimspace(var.owner)) > 0
    error_message = "An installation owner is required."
  }
}

variable "image" {
  type        = string
  description = "Existing public or ACR image pinned to an immutable SHA-256 digest."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Supply a registry/repository@sha256:<64 lowercase hex characters>, not a tag."
  }
}

variable "deploy_hub" {
  type        = bool
  default     = false
  description = "Keep false for bootstrap. Only deploy-hub enables Hub after setup succeeds."
}

variable "acr_id" {
  type        = string
  default     = null
  description = "Optional existing ACR resource ID. No registry is created or deleted."
}

variable "postgres_admin_password" {
  type        = string
  sensitive   = true
  description = "Explicit PostgreSQL administrator password. Stored in protected Terraform state."

  validation {
    condition     = length(var.postgres_admin_password) >= 16
    error_message = "Use an independently generated PostgreSQL password of at least 16 characters."
  }
}

variable "postgres_sku" {
  type        = string
  default     = "B_Standard_B1ms"
  description = "PostgreSQL Flexible Server SKU; assess capacity before production use."
}

variable "postgres_version" {
  type        = string
  default     = "17"
  description = "PostgreSQL major version supported by Hub and the selected region."
}

variable "backup_retention_days" {
  type        = number
  default     = 14
  description = "PostgreSQL point-in-time recovery retention."

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "PostgreSQL retention must be between 7 and 35 days."
  }
}

variable "runtime_database_secret" {
  type = object({
    key_vault_id = string
    secret_id    = string
  })
  description = "Existing RBAC Key Vault and HTTPS secret URL containing the replica_runtime database URL with sslmode=verify-full. Never supply the administrator URL."

  validation {
    condition = (
      can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", var.runtime_database_secret.key_vault_id)) &&
      can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}(/[a-fA-F0-9]{32})?$", var.runtime_database_secret.secret_id)) &&
      lower(try(split("/", var.runtime_database_secret.secret_id)[2], "")) == "${lower(try(split("/", var.runtime_database_secret.key_vault_id)[8], ""))}.vault.azure.net"
    )
    error_message = "Supply a Key Vault resource ID and a public-cloud HTTPS secret URL, not a secret value."
  }
}

variable "setup_database_secret" {
  type = object({
    key_vault_id = string
    secret_id    = string
  })
  description = "Existing RBAC Key Vault and HTTPS secret URL containing the replica_migration database URL with sslmode=verify-full."

  validation {
    condition = (
      can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", var.setup_database_secret.key_vault_id)) &&
      can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}(/[a-fA-F0-9]{32})?$", var.setup_database_secret.secret_id)) &&
      lower(try(split("/", var.setup_database_secret.secret_id)[2], "")) == "${lower(try(split("/", var.setup_database_secret.key_vault_id)[8], ""))}.vault.azure.net" &&
      lower("${var.setup_database_secret.key_vault_id}/secrets/${try(split("/", var.setup_database_secret.secret_id)[4], "")}") != lower("${var.runtime_database_secret.key_vault_id}/secrets/${try(split("/", var.runtime_database_secret.secret_id)[4], "")}")
    )
    error_message = "Supply a separate migration secret URL and its Key Vault resource ID."
  }
}

locals {
  runtime_reserved_environment_names = [
    "DATABASE_URL", "DATABASE_RUNTIME_ROLE", "NODE_ENV", "RUNTIME_MODE", "HOST", "PORT",
    "CLIENT_DIRECTORY", "SHUTDOWN_TIMEOUT_MS", "ARTIFACT_STORAGE_PROVIDER",
    "ARTIFACT_STORAGE_DIRECTORY", "AZURE_STORAGE_ACCOUNT", "AZURE_STORAGE_CONTAINER",
    "AZURE_CLIENT_ID", "AZURE_KEY_VAULT_SECRET_REFERENCES",
  ]
}

variable "runtime_environment_variables" {
  type        = map(string)
  default     = {}
  nullable    = false
  description = "Non-secret Hub runtime environment values, stored directly in Terraform state and Container Apps configuration. Use runtime_secret_references for credentials."

  validation {
    condition = alltrue([
      for name, value in var.runtime_environment_variables :
      can(regex("^[A-Z][A-Z0-9_]{0,40}$", name)) &&
      !contains(local.runtime_reserved_environment_names, name) &&
      !contains(keys(local.github_environment), name) &&
      !contains(keys(var.runtime_secret_references), name) &&
      value != null
    ])
    error_message = "Use uppercase environment names of at most 41 characters and non-null string values; deployment-owned settings and secret-reference names cannot be overridden."
  }

  validation {
    condition = alltrue([
      for name in keys(var.runtime_environment_variables) :
      !can(regex("(^|_)(SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|APIKEY|KEY)S?(_|$)", name))
    ])
    error_message = "Credential-named settings, such as names containing a SECRET, TOKEN, PASSWORD, CREDENTIAL, or KEY word, cannot be stored in Terraform state. Move each to runtime_secret_references as a Key Vault secret reference."
  }

  validation {
    condition = (
      alltrue([
        for name in ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID"] :
        !contains(keys(var.runtime_environment_variables), name) || (
          try(can(regex("^[1-9][0-9]*$", var.runtime_environment_variables[name])) && tonumber(var.runtime_environment_variables[name]) <= 9007199254740991, false)
        )
      ]) &&
      (!contains(keys(var.runtime_environment_variables), "GITHUB_CLIENT_ID") || try(
        can(regex("^[^\\x{9}-\\x{d}\\x{20}\\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}]+$", var.runtime_environment_variables["GITHUB_CLIENT_ID"])) &&
        length(regexall(".", var.runtime_environment_variables["GITHUB_CLIENT_ID"])) +
        length(regexall("[\\x{10000}-\\x{10ffff}]", var.runtime_environment_variables["GITHUB_CLIENT_ID"])) <= 200,
      false)) &&
      (!contains(keys(var.runtime_environment_variables), "GITHUB_PROVIDER_REVISION") || (
        try(can(regex("^[1-9][0-9]*$", var.runtime_environment_variables["GITHUB_PROVIDER_REVISION"])) && tonumber(var.runtime_environment_variables["GITHUB_PROVIDER_REVISION"]) <= 2147483647, false)
      ))
    )
    error_message = "GitHub App and installation IDs must be positive safe integers, client IDs must contain 1–200 non-whitespace characters, and provider revisions must be positive integers at most 2147483647."
  }

  validation {
    condition = !contains(keys(var.runtime_environment_variables), "HUB_APPLICATION_ORIGIN") ? true : try(
      length(var.runtime_environment_variables["HUB_APPLICATION_ORIGIN"]) <= 500 && alltrue([
        for parts in [try(regex("^https://(\\[[0-9a-f:]+\\]|[a-z0-9!\"$&'()*+,;=_`{}~.-]+)(?::(0|[1-9][0-9]{0,4}))?$", var.runtime_environment_variables["HUB_APPLICATION_ORIGIN"]), [])] :
        length(parts) == 2 && alltrue([
          for host in [try(parts[0], "")] :
          (try(parts[1], null) == null ? true : (
            parts[1] != "443" && tonumber(parts[1]) <= 65535
            )) && (startswith(host, "[") ? alltrue([
              for ip in [try(cidrhost("${trim(host, "[]")}/128", 0), "")] :
              trim(host, "[]") == ip || trim(host, "[]") == try(format(
                "::ffff:%x:%x",
                256 * tonumber(split(".", ip)[0]) + tonumber(split(".", ip)[1]),
                256 * tonumber(split(".", ip)[2]) + tonumber(split(".", ip)[3]),
              ), "")
            ]) : (
            !can(regex("(?:^|\\.)(?:[0-9]+|0x[0-9a-f]*)(?:\\.)?$", host)) ||
            try(cidrhost("${host}/32", 0) == host, false)
          ))
        ])
      ]), false
    )
    error_message = "Supply HUB_APPLICATION_ORIGIN as an exact HTTPS origin with a lowercase host and no default port, path, query, fragment, credentials, or trailing slash."
  }

  validation {
    condition = (
      (!contains(keys(var.runtime_secret_references), "GITHUB_APP_PRIVATE_KEY_BASE64") || (
        (var.github_app_id != null || try(var.runtime_environment_variables["GITHUB_APP_ID"] != "", false)) &&
        (
          # Mirrors Hub: an App used only for Copilot needs no sign-in, installation, or webhook settings.
          (
            try(trimspace(var.runtime_environment_variables["REPLICA_COPILOT_AUTHENTICATION"]), "") == "github-app-installation" &&
            alltrue([
              for name in ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_PROVIDER_REVISION", "GITHUB_APP_INSTALLATION_ID", "GITHUB_WEBHOOK_SECRET"] :
              try(trimspace(merge(var.runtime_environment_variables, local.github_environment)[name]), "") == "" &&
              !contains(keys(var.runtime_secret_references), name)
            ])
            ) || (
            (var.github_client_id != null || try(var.runtime_environment_variables["GITHUB_CLIENT_ID"] != "", false)) &&
            (var.github_app_installation_id != null || try(var.runtime_environment_variables["GITHUB_APP_INSTALLATION_ID"] != "", false))
          )
        )
      )) &&
      (!contains(keys(var.runtime_secret_references), "GITHUB_CLIENT_SECRET") ||
      var.github_client_id != null || try(var.runtime_environment_variables["GITHUB_CLIENT_ID"] != "", false))
    )
    error_message = "Supply the client ID for a GitHub client secret, and the App, client, and installation IDs for a private key (only the App ID for a Copilot-only App), through named variables or runtime_environment_variables."
  }
}

variable "runtime_secret_references" {
  type = map(object({
    key_vault_id = string
    secret_id    = string
  }))
  default     = {}
  description = "Existing RBAC Key Vault secret references keyed by uppercase runtime environment name. Values remain outside Terraform."

  validation {
    condition = length(keys(var.runtime_secret_references)) <= 63 && alltrue([
      for name in keys(var.runtime_secret_references) :
      can(regex("^[A-Z][A-Z0-9_]{0,40}$", name)) &&
      !contains(concat(local.runtime_reserved_environment_names, ["GITHUB_APP_ID", "GITHUB_CLIENT_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_PROVIDER_REVISION"]), name)
    ])
    error_message = "Supply at most 63 additional secret references, using uppercase environment names of at most 41 characters; deployment-owned settings cannot be overridden."
  }

  validation {
    condition = alltrue([
      for secret in values(var.runtime_secret_references) :
      can(regex("^/subscriptions/[^/]+/resourceGroups/[^/]+/providers/Microsoft.KeyVault/vaults/[^/]+$", secret.key_vault_id)) &&
      can(regex("^https://[a-zA-Z0-9-]{1,24}\\.vault\\.azure\\.net/secrets/[a-zA-Z0-9-]{1,127}(/[a-fA-F0-9]{32})?$", secret.secret_id)) &&
      lower(try(split("/", secret.secret_id)[2], "")) == "${lower(try(split("/", secret.key_vault_id)[8], ""))}.vault.azure.net" &&
      lower("${secret.key_vault_id}/secrets/${try(split("/", secret.secret_id)[4], "")}") != lower("${var.setup_database_secret.key_vault_id}/secrets/${try(split("/", var.setup_database_secret.secret_id)[4], "")}")
    ])
    error_message = "Supply Key Vault resource IDs and HTTPS secret URLs, not secret values."
  }
}

variable "hub_application_origin" {
  type        = string
  default     = null
  description = "Optional exact public HTTPS origin for Hub authentication and setup."

  validation {
    condition = var.hub_application_origin == null ? true : (
      length(var.hub_application_origin) <= 500 && alltrue([
        for parts in [try(regex("^https://(\\[[0-9a-f:]+\\]|[a-z0-9!\"$&'()*+,;=_`{}~.-]+)(?::(0|[1-9][0-9]{0,4}))?$", var.hub_application_origin), [])] :
        length(parts) == 2 && alltrue([
          for host in [try(parts[0], "")] :
          (try(parts[1], null) == null ? true : (
            parts[1] != "443" && tonumber(parts[1]) <= 65535
            )) && (startswith(host, "[") ? alltrue([
              # Terraform renders IPv4-mapped IPv6 as dotted IPv4; URL origins use hexadecimal.
              for ip in [try(cidrhost("${trim(host, "[]")}/128", 0), "")] :
              trim(host, "[]") == ip || trim(host, "[]") == try(format(
                "::ffff:%x:%x",
                256 * tonumber(split(".", ip)[0]) + tonumber(split(".", ip)[1]),
                256 * tonumber(split(".", ip)[2]) + tonumber(split(".", ip)[3]),
              ), "")
            ]) : (
            # A host ending in a number is interpreted as IPv4 by URL parsers.
            !can(regex("(?:^|\\.)(?:[0-9]+|0x[0-9a-f]*)(?:\\.)?$", host)) ||
            try(cidrhost("${host}/32", 0) == host, false)
          ))
        ])
      ])
    )
    error_message = "Supply an exact HTTPS origin such as https://hub.example.com, with a lowercase host and no default port, path, query, fragment, credentials, or trailing slash."
  }

  validation {
    condition     = var.hub_application_origin == null || !contains(keys(var.runtime_secret_references), "HUB_APPLICATION_ORIGIN")
    error_message = "Supply HUB_APPLICATION_ORIGIN either as hub_application_origin or as a runtime secret reference, not both."
  }
}

variable "github_app_id" {
  type        = string
  default     = null
  description = "Optional numeric GitHub App ID, passed to Hub as GITHUB_APP_ID. Required when GITHUB_APP_PRIVATE_KEY_BASE64 is referenced."

  validation {
    condition     = var.github_app_id == null ? true : try(can(regex("^[1-9][0-9]*$", var.github_app_id)) && tonumber(var.github_app_id) <= 9007199254740991, false)
    error_message = "Supply the GitHub App ID as a positive safe integer."
  }

}

variable "github_client_id" {
  type        = string
  default     = null
  description = "Optional GitHub App client ID, passed to Hub as GITHUB_CLIENT_ID. Required when the client secret or private key is referenced."

  validation {
    # Hub checks JavaScript whitespace and counts UTF-16 code units.
    condition = var.github_client_id == null ? true : (
      can(regex("^[^\\x{9}-\\x{d}\\x{20}\\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}]+$", var.github_client_id)) &&
      length(regexall(".", var.github_client_id)) +
      length(regexall("[\\x{10000}-\\x{10ffff}]", var.github_client_id)) <= 200
    )
    error_message = "Supply a GitHub App client ID with 1–200 non-whitespace characters."
  }

}

variable "github_app_installation_id" {
  type        = string
  default     = null
  description = "Optional numeric GitHub App installation ID, passed to Hub as GITHUB_APP_INSTALLATION_ID. Required when GITHUB_APP_PRIVATE_KEY_BASE64 is referenced."

  validation {
    condition     = var.github_app_installation_id == null ? true : try(can(regex("^[1-9][0-9]*$", var.github_app_installation_id)) && tonumber(var.github_app_installation_id) <= 9007199254740991, false)
    error_message = "Supply the GitHub App installation ID as a positive safe integer."
  }

}

variable "github_provider_revision" {
  type        = number
  default     = null
  description = "Optional positive integer passed to Hub as GITHUB_PROVIDER_REVISION. Increase it whenever GitHub App credentials or references change."

  validation {
    condition     = var.github_provider_revision == null ? true : var.github_provider_revision >= 1 && var.github_provider_revision <= 2147483647 && floor(var.github_provider_revision) == var.github_provider_revision
    error_message = "Supply a GitHub provider revision from 1 to 2147483647."
  }
}

variable "custom_hostname" {
  type        = string
  default     = null
  description = "Optional DNS hostname already verified for this app."
}

variable "certificate_id" {
  type        = string
  default     = null
  description = "Existing Container Apps environment certificate ID for custom_hostname."

  validation {
    condition     = (var.custom_hostname == null) == (var.certificate_id == null)
    error_message = "Supply both custom_hostname and certificate_id, or neither."
  }
}
