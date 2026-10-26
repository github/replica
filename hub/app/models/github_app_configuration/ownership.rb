# Refreshes App ownership without changing credentials or ending Hub sessions.
class GithubAppConfiguration::Ownership < ActiveRecord::AssociatedObject
  # Accepts owner metadata only from GitHub's authenticated response for this App.
  def refresh!
    credentials = record.credential_snapshot
    version = record.lock_version
    app = record.github_client.apps.get(token: record.tokens.app)
    attributes = attributes_for(app)

    GithubAppConfiguration.with_credentials!(**credentials) do
      record.with_lock do
        raise GithubAppConfiguration::Superseded if record.lock_version != version

        transferred = record.owner_github_id != attributes.fetch(:owner_github_id) ||
          record.owner_type != attributes.fetch(:owner_type)
        record.assign_attributes(attributes)
        record.installation_state = "removed" if transferred && record.installation_id
        record.save! if record.changed?
        if transferred
          record.repositories.remove_all!
          SecurityAuditEvent.record! \
            action: "github_app.transfer", outcome: "succeeded", actor: nil,
            context: { source: "command", github_app_configuration_id: record.id }
        end
      end
    end
  end

  private

  # Rejects incomplete identity before it can replace a saved owner.
  def attributes_for(app)
    raise KeyError if !app.is_a?(Hash) || !app["id"].is_a?(Integer) || app["id"] != record.github_app_id

    owner = app.fetch("owner")
    raise KeyError if !owner.is_a?(Hash)

    attributes = {
      owner_github_id: owner.fetch("id"),
      owner_login: owner.fetch("login"),
      owner_type: owner.fetch("type"),
      app_slug: app.fetch("slug")
    }
    valid = attributes[:owner_github_id].is_a?(Integer) && attributes[:owner_github_id].positive? &&
      GithubAppConfiguration::OWNER_TYPES.include?(attributes[:owner_type]) &&
      attributes.values_at(:owner_login, :app_slug).all? do |value|
        value.is_a?(String) && value.match?(/\A[A-Za-z0-9][A-Za-z0-9-]*\z/)
      end
    raise KeyError if !valid

    attributes
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an invalid App identity"
  end
end
