# Reports setup health while keeping stored credentials private.
class GithubAppConfiguration::Diagnostics < ActiveRecord::AssociatedObject
  Result = Data.define(:configuration, :app, :installation)

  # Checks that Hub can authenticate as the configured App and installation.
  def call
    app = record.github_client.apps.get(token: record.tokens.app)
    verify_app!(app)
    owner = app.fetch("owner")
    if owner.fetch("id") != record.owner_github_id || owner.fetch("type") != record.owner_type
      return Result.new \
        configuration: "configured",
        app: "owner changed; waiting for synchronization",
        installation: "needs rechecking"
    end

    remote_installation = if record.installation_id
      begin
        record.github_client.installations.get \
          record.installation_id,
          token: record.tokens.app
      rescue GithubClient::NotFound
        nil
      end
    end
    Result.new(configuration: "configured", app: "reachable", installation: installation_status(remote_installation))
  end

  private

  # A changed owner is recoverable, but another App or malformed identity is not.
  def verify_app!(app)
    raise GithubClient::InvalidResponse, "GitHub returned incomplete App identity" if
      !app.is_a?(Hash) || !app["owner"].is_a?(Hash)

    owner = app.fetch("owner")
    valid = app.fetch("id").is_a?(Integer) && app.fetch("id") == record.github_app_id &&
      owner.fetch("id").is_a?(Integer) && owner.fetch("id").positive? &&
      GithubAppConfiguration::OWNER_TYPES.include?(owner.fetch("type"))
    raise GithubClient::InvalidResponse, "GitHub App identity does not match" if !valid
  rescue KeyError, TypeError, ArgumentError
    raise GithubClient::InvalidResponse, "GitHub returned incomplete App identity"
  end

  # Describes whether the configured installation is available through GitHub.
  def installation_status(payload)
    return "not installed" if payload.nil?

    account = payload.fetch("account")
    return "owner mismatch" if account.fetch("id").to_i != record.owner_github_id ||
      account.fetch("id").to_i != record.installation_account_github_id

    payload["suspended_at"].present? ? "suspended" : "reachable"
  rescue KeyError, TypeError, ArgumentError
    "invalid response"
  end
end
