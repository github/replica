# Records installation status only for this Hub's configured owner.
class GithubAppConfiguration::Installation < ActiveRecord::AssociatedObject
  class OwnerMismatch < StandardError; end

  # Recovers an owner's replacement installation even when GitHub notifications were missed.
  def synchronize!
    credentials = record.credential_snapshot
    version = record.lock_version
    payload = if record.installation_id && record.installation_state != "removed" &&
        record.installation_account_github_id == record.owner_github_id
      begin
        remote_installation(record.installation_id)
      rescue GithubClient::NotFound
        installation_for_owner
      end
    else
      installation_for_owner
    end
    if payload
      record_status!(payload, credentials:, expected_version: version)
    else
      record_missing!(credentials:, expected_version: version)
    end
  end

  # Fetches the current installation from GitHub and saves its status.
  def reconcile!(installation_id)
    snapshot = record.credential_snapshot
    version = record.lock_version
    GithubAppConfiguration.with_credentials!(**snapshot) { }
    record_status! \
      remote_installation(installation_id),
      credentials: snapshot,
      expected_version: version
  end

  # Commits browser setup and its audit only after all GitHub requests finish.
  def install!(installation_id)
    credentials = record.credential_snapshot
    GithubAppConfiguration.with_credentials!(**credentials) { }
    payload = remote_installation(installation_id)
    verify_app!(payload)
    verify_owner!(payload.fetch("account"))
    state = state_for(payload, nil)
    installation_id = payload.fetch("id").to_i
    snapshot = if state == "active"
      token = record.tokens.for_installation(installation_id)
      record.repositories.snapshot(token:)
    end

    GithubAppConfiguration.with_credentials!(**credentials) do
      save_status!(payload, state:)
      state == "active" ? record.repositories.synchronize!(snapshot:) : record.repositories.remove_all!
      SecurityAuditEvent.record! \
        action: "github_app_setup.install",
        outcome: "succeeded",
        context: (Current.security_audit_context || {}).merge(github_app_configuration_id: record.id)
    end
  end

  # Retains verified webhook status even when its later repository refresh fails.
  def record_status!(payload, action: nil, credentials: record.credential_snapshot,
    expected_version: record.lock_version)
    verify_app!(payload)
    return if stale_removal?(payload, action)

    state = state_for(payload, action)
    save_status!(payload, state:, credentials:, expected_version:, action:)
    state == "active" ? record.repositories.synchronize! : record.repositories.remove_all!
  end

  private

  # Fetches the installation without holding a local write transaction.
  def remote_installation(installation_id)
    payload = record.github_client.installations.get \
      installation_id,
      token: record.tokens.app
    verify_app!(payload)
    raise GithubClient::InvalidResponse, "GitHub returned another installation" if
      payload.fetch("id") != installation_id.to_i

    payload
  end

  # A missing installation is expected while the new owner arranges reinstallation.
  def installation_for_owner
    payload = record.github_client.installations.for_account \
      login: record.owner_login,
      type: record.owner_type,
      token: record.tokens.app
    verify_app!(payload)
    payload
  rescue GithubClient::NotFound
    nil
  end

  # Confirms absence without treating an outage or permission failure as removal.
  def record_missing!(credentials:, expected_version:)
    GithubAppConfiguration.with_credentials!(**credentials) do
      record.with_lock do
        raise GithubAppConfiguration::Superseded if record.lock_version != expected_version

        record.installation_state = "removed" if record.installation_id
        record.installation_checked_at = Time.current
        if record.changed.excluding("installation_checked_at").any?
          record.save!
        else
          record.update_columns(installation_checked_at: record.installation_checked_at)
        end
        record.repositories.remove_all!
      end
    end
  end

  # Applies the verified status without performing GitHub I/O.
  def save_status!(payload, state:, credentials: record.credential_snapshot,
    expected_version: record.lock_version, action: nil)
    GithubAppConfiguration.with_credentials!(**credentials) do
      record.with_lock do
        raise GithubAppConfiguration::Superseded if record.lock_version != expected_version

        account = payload.fetch("account")
        if action == "deleted"
          matches = record.installation_id == payload.fetch("id") &&
            record.installation_account_github_id == account.fetch("id")
          raise OwnerMismatch, "Removal does not match the saved installation" if !matches
        else
          verify_owner!(account)
        end
        checked_at = Time.current
        record.assign_attributes \
          installation_id: payload.fetch("id").to_i,
          installation_account_github_id: account.fetch("id"),
          installation_state: state,
          installed_at: state == "active" ? record.installed_at || checked_at : record.installed_at,
          suspended_at: state == "suspended" ? record.suspended_at || checked_at : nil
        if record.changed?
          record.installation_checked_at = checked_at
          record.save!
        else
          # Poll freshness alone must not invalidate an administrator's confirmation.
          record.update_columns(installation_checked_at: checked_at)
        end
      end
    end
  end

  # A signed webhook or API response must still identify this App and a real installation.
  def verify_app!(payload)
    valid = payload.is_a?(Hash) && payload["app_id"].is_a?(Integer) &&
      payload["app_id"] == record.github_app_id &&
      payload["id"].is_a?(Integer) && payload["id"].positive? &&
      payload["account"].is_a?(Hash) &&
      payload["account"]["id"].is_a?(Integer) && payload["account"]["id"].positive?
    raise GithubClient::InvalidResponse, "GitHub returned an invalid installation identity" if !valid
  end

  # Confirms the installation belongs to the configured GitHub owner.
  def verify_owner!(account)
    matches = account.fetch("id").to_i == record.owner_github_id &&
      account.fetch("type") == record.owner_type
    raise OwnerMismatch, "Installation owner does not match the configured GitHub App owner" if !matches
  end

  # Converts GitHub's installation details into a status Hub stores.
  def state_for(payload, action)
    return "removed" if action == "deleted"

    return "suspended" if action == "suspend" || payload["suspended_at"].present?

    "active"
  end

  # Ignores a delayed removal for an installation that is no longer current.
  def stale_removal?(payload, action)
    action == "deleted" && record.installation_id.present? &&
      record.installation_id != payload.fetch("id").to_i
  end
end
