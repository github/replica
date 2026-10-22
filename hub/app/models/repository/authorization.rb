# Checks a user's current GitHub permission for one installed repository.
class Repository::Authorization < ActiveRecord::AssociatedObject
  CACHE_TTL = 1.minute
  PERMISSION_LEVELS = { "none" => 0, "read" => 1, "write" => 2, "maintain" => 3, "admin" => 4 }.freeze
  NORMALIZED_PERMISSIONS = {
    "pull" => "read", "read" => "read", "triage" => "read",
    "push" => "write", "write" => "write", "maintain" => "maintain",
    "admin" => "admin"
  }.freeze

  attr_reader :share_link_creation_proof

  # Reports whether the user currently meets the requested permission level.
  def authorized?(
    user, minimum: :read, fresh: false, configuration: GithubAppConfiguration.current,
    cache: Rails.cache
  )
    permission = permission_for(user, fresh:, configuration:, cache:)
    sufficient?(permission, minimum:)
  end

  # Returns the user's current normalized GitHub permission.
  def permission_for(
    user, fresh: false, configuration: GithubAppConfiguration.current,
    cache: Rails.cache, payload: nil
  )
    return "none" if record.installation_state != "active"
    if LocalDevelopment.enabled?
      local_user = user&.persisted? && user.github_id.nil?
      return local_user && record.local? &&
        LocalDevelopment.repository_available?(record.local_path, identity: record.local_identity) ? "admin" : "none"
    end

    if fresh
      creator = registered_user(user)
      @share_link_creation_proof = creator ? ShareLinkCreatorRevocation.proof_for(record, creator) : nil
      fetch_permission(user, configuration)
    else
      cache.fetch(cache_key(user), expires_in: CACHE_TTL) do
        fetch_permission(user, configuration, payload:)
      end
    end
  end

  # Avoids fetching selector permissions that are still cached.
  def cached_permission(user, cache: Rails.cache)
    cache.read(cache_key(user))
  end

  # Reports whether one normalized permission meets the required level.
  def sufficient?(permission, minimum:)
    PERMISSION_LEVELS.fetch(permission.to_s, 0) >= PERMISSION_LEVELS.fetch(minimum.to_s)
  end

  private

  # Reads effective permission and verifies GitHub returned the expected user.
  def fetch_permission(user, configuration, payload: nil)
    return "none" if configuration.nil? || configuration.installation_state != "active"

    raise payload if payload.is_a?(GithubClient::Error)

    payload ||= configuration.github_client.repositories.permission \
      record,
      user,
      token: configuration.tokens.installation
    raise GithubClient::InvalidResponse, "GitHub returned an invalid repository permission" if !payload.is_a?(Hash)

    profile = payload.fetch("user")
    return "none" if profile.nil?
    raise GithubClient::InvalidResponse, "GitHub returned an invalid permission identity" if !profile.is_a?(Hash)

    returned_id = profile.fetch("id")
    return "none" if !returned_id.is_a?(Integer) || returned_id != user.github_id

    permission = payload.fetch("permission")
    if permission == "none"
      creator = registered_user(user)
      ShareLinkCreatorRevocation.confirm_loss!(repository: record, user: creator) if creator
      return "none"
    end

    normalized = NORMALIZED_PERMISSIONS.fetch(permission) do
      raise GithubClient::InvalidResponse, "GitHub returned an unknown repository permission"
    end
    normalized == "write" && payload["role_name"] == "maintain" ? "maintain" : normalized
  rescue GithubClient::NotFound
    "none"
  rescue KeyError, TypeError
    raise \
      GithubClient::InvalidResponse,
      "GitHub returned an incomplete repository permission"
  end

  # Resolves permission identities to saved creators before revoking their links.
  def registered_user(identity)
    identity.is_a?(User) && identity.persisted? ? identity : User.find_by(github_id: identity.github_id)
  end

  # Separates cached permission by durable identities and repository state.
  def cache_key(user)
    [ "repository-permission-v2", record.github_id, user.github_id, record.updated_at.to_f ]
  end
end
