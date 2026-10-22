# Creates the short-lived tokens used for GitHub App requests.
class GithubAppConfiguration::Tokens < ActiveRecord::AssociatedObject
  # GitHub refused to create a Copilot token because the installation lacks the App's Copilot
  # Requests organization permission.
  class CopilotPermissionMissing < GithubClient::Error; end

  # The only permission a Copilot token asks for, and the only one Hub accepts on it. A token with any
  # other permission, even read-only repository metadata, could read the repositories the App's
  # installation covers.
  COPILOT_PERMISSIONS = { organization_copilot_requests: "read" }.freeze
  COPILOT_PERMISSION_ERROR = "The permissions requested are not granted to this installation.".freeze

  # Creates a short-lived token that authenticates as the GitHub App.
  def app
    now = Time.current.to_i
    JWT.encode({ iat: now - 60, exp: now + 9.minutes.to_i, iss: record.client_id },
      OpenSSL::PKey::RSA.new(record.private_key), "RS256")
  rescue OpenSSL::PKey::RSAError => error
    raise GithubClient::InvalidResponse, "The stored GitHub App private key is invalid: #{error.message}"
  end

  # Creates and briefly reuses one installation access token.
  def installation
    raise GithubClient::InvalidResponse, "The GitHub App installation is not active" if record.installation_state != "active"

    for_installation(record.installation_id)
  end

  # Fetches a token for an owner-verified installation before its state is saved.
  def for_installation(installation_id)
    if !installation_id.is_a?(Integer) || !installation_id.positive?
      raise GithubClient::InvalidResponse, "GitHub returned an invalid installation"
    end

    if @installation_id == installation_id && @installation_token &&
        @installation_token_expires_at > 1.minute.from_now
      return @installation_token
    end

    payload = record.github_client.installations.create_token \
      installation_id,
      token: app
    raise KeyError if !payload.is_a?(Hash)

    token = payload.fetch("token")
    expires_at = Time.iso8601(payload.fetch("expires_at"))
    raise KeyError if !token.is_a?(String) || token.blank? || expires_at <= Time.current

    @installation_token = token
    @installation_token_expires_at = expires_at
    @installation_id = installation_id
    @installation_token
  rescue KeyError, TypeError, ArgumentError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete installation token"
  end

  # Creates a new one-hour token for one replica-learning command. It can only make Copilot requests,
  # which Copilot bills to the organization that installed the App. Hub never reuses it, never uses it
  # for other GitHub requests, and never stores it. Raises CopilotPermissionMissing when the
  # installation has not granted the App's Copilot Requests organization permission.
  def copilot(snapshot: record.copilot_snapshot)
    GithubAppConfiguration.with_copilot_installation!(snapshot) { }

    payload = record.github_client.installations.create_token \
      snapshot.fetch(:installation_id),
      token: app,
      permissions: COPILOT_PERMISSIONS
    GithubAppConfiguration.with_copilot_installation!(snapshot) { }
    raise KeyError if !payload.is_a?(Hash)

    token = payload.fetch("token")
    expires_at = Time.iso8601(payload.fetch("expires_at"))
    raise KeyError if !token.is_a?(String) || token.blank? || expires_at <= Time.current

    # GitHub grants only the requested permissions. A token with more must not reach Copilot's runtime.
    if payload.fetch("permissions") != COPILOT_PERMISSIONS.stringify_keys
      raise GithubClient::InvalidResponse, "GitHub returned a Copilot token with other permissions"
    end

    token
  rescue GithubClient::Error => error
    raise if !copilot_permission_missing?(error)

    raise CopilotPermissionMissing.new \
      "The GitHub App installation has not granted the Copilot Requests organization permission",
      status: error.status
  rescue KeyError, TypeError, ArgumentError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete installation token"
  end

  private

  # Recognizes the exact observed GitHub validation response, not every possible HTTP 422.
  def copilot_permission_missing?(error)
    error.status == 422 && error.response.is_a?(Hash) &&
      error.response["message"] == COPILOT_PERMISSION_ERROR
  end
end
