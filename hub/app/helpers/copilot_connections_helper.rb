# Describes the Copilot credential the operator configured, in the words that fit who Copilot bills.
module CopilotConnectionsHelper
  # Translates key under scope. When Copilot bills the organization that installed Hub's GitHub App,
  # the organization's wording under scope.organization replaces the token owner's where it differs.
  def copilot_billing_t(key, scope: "copilot_connection", **options)
    return t("#{scope}.#{key}", **options) if !CopilotConnection.organization_billing?

    t("#{scope}.organization.#{key}", default: :"#{scope}.#{key}", **options)
  end
end
