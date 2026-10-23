# Synchronizes the durable repository records available to this App installation.
class GithubAppConfiguration::Repositories < ActiveRecord::AssociatedObject
  # Validates the remote snapshot before any local installation changes are saved.
  def snapshot(token: record.tokens.installation)
    payloads = record.github_client.installations.repositories(token:)
    payloads.map { attributes_for(_1) }
  end

  # Stores a prepared snapshot, or fetches the current installation's repositories.
  def synchronize!(snapshot: nil)
    return remove_all! if record.installation_state != "active"

    installation = record.installation_snapshot
    attributes = snapshot || self.snapshot
    now = Time.current

    record.with_installation!(snapshot: installation) do
      active_ids = attributes.map { _1.fetch(:github_id) }
      attributes.each { synchronize_repository!(_1.merge(synchronized_at: now)) }
      Repository.active.where.not(github_id: active_ids).update_all \
        installation_state: "removed", removed_at: now, synchronized_at: now, updated_at: now
    end
  end

  # Marks all repositories unavailable when the App installation is inactive.
  def remove_all!
    now = Time.current
    record.with_installation! do
      Repository.active.update_all \
        installation_state: "removed", removed_at: now, synchronized_at: now, updated_at: now
    end
  end

  private

  # Converts one GitHub repository response into safe local attributes.
  def attributes_for(payload)
    attributes = {
      github_id: payload.fetch("id").to_i,
      name_with_owner: payload.fetch("full_name"),
      default_branch: payload.fetch("default_branch")
    }
    valid = attributes[:github_id].positive? && attributes.values_at(:name_with_owner, :default_branch).all?(&:present?)
    raise \
      GithubClient::InvalidResponse,
      "GitHub returned an invalid repository" if !valid

    attributes
  rescue KeyError, TypeError
    raise \
      GithubClient::InvalidResponse,
      "GitHub returned an incomplete repository"
  end

  # Creates, renames, or reactivates one repository by immutable GitHub ID.
  def synchronize_repository!(attributes)
    repository = Repository.find_or_initialize_by(github_id: attributes.fetch(:github_id))
    repository.update! \
      attributes.merge(installation_state: "active", removed_at: nil)
  end
end
