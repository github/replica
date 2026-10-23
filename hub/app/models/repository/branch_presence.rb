# Retains deleted GitHub branches and resumes only their latest matching history.
class Repository::BranchPresence < ActiveRecord::AssociatedObject
  # Captures both identity and revision so an old scan cannot select a new owner.
  def observations
    Prototype.uncached do
      record.prototypes.order(:branch_deleted_at, :id).each_with_object({}) do |prototype, result|
        previous = result[prototype.branch_name]
        next if previous && previous.branch_deleted_at.nil?

        result[prototype.branch_name] = prototype
      end
    end
  end

  # Validates a complete scan before any absence can change retained state.
  def heads(configuration:, corroborate: [])
    branches = configuration.github_client.repositories.branches(record, token: configuration.tokens.installation)
    raise GithubClient::InvalidResponse, "GitHub returned an invalid branch list" if !branches.is_a?(Array)

    heads = branches.each_with_object({}) do |branch, result|
      if !branch.is_a?(Hash) || !branch["commit"].is_a?(Hash)
        raise GithubClient::InvalidResponse, "GitHub returned invalid branch discovery data"
      end

      name = branch.fetch("name")
      sha = branch.fetch("commit").fetch("sha")
      if !name.is_a?(String) || name.strip.empty? || name.length > 255 ||
          !sha.is_a?(String) || !Build::COMMIT_SHA_FORMAT.match?(sha) || result.key?(name)
        raise GithubClient::InvalidResponse, "GitHub returned invalid branch discovery data"
      end

      result[name] = sha
    end
    (corroborate - heads.keys).each do |branch_name|
      sha = current_head(branch_name, configuration:)
      heads[branch_name] = sha if sha
    end
    heads
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned incomplete branch discovery data"
  end

  # Checks one exact ref; a repository failure is never proof of deletion.
  def current_head(branch_name, configuration:)
    repositories = configuration.github_client.repositories
    token = configuration.tokens.installation
    reference = begin
      repositories.reference(record, branch_name, token:)
    rescue GithubClient::NotFound
      repositories.confirm_access!(record, token:)
      return nil
    end
    if !reference.is_a?(Hash) || reference["ref"] != "refs/heads/#{branch_name}" ||
        !reference["object"].is_a?(Hash) || reference["object"]["type"] != "commit" ||
        !reference["object"]["sha"].is_a?(String) ||
        !Build::COMMIT_SHA_FORMAT.match?(reference["object"]["sha"])
      raise GithubClient::InvalidResponse, "GitHub returned invalid branch reference data"
    end

    reference["object"]["sha"]
  end

  # Checks ancestry outside locks, then accepts it only against the captured owner.
  def record_head!(branch_name:, commit_sha:, observed:, configuration:,
    installation: configuration.installation_snapshot, default_branch: record.default_branch)
    resume = if observed&.branch_deleted_at.present?
      observed.retired_head_sha.present? && ancestor?(observed.retired_head_sha, commit_sha, configuration:)
    end
    configuration.with_installation!(snapshot: installation) do
      record.build_discoveries.record! \
        branch_name:,
        commit_sha:,
        default_branch:,
        branch_head: true,
        expected_prototype_id: observed&.id,
        expected_head_observation_revision: observed&.head_observation_revision || 0,
        resume_retired: resume
    end
  end

  # Saves the last accepted head once, without unregistering or deleting reviews.
  def record_missing!(branch_name:, observed:)
    record.with_lock do
      return if record.local? || record.installation_state != "active" || observed.nil?

      prototype = record.reviewable_prototypes.active.find_by(branch_name:)
      return if prototype.nil? || prototype.id != observed.id

      prototype.with_lock do
        return if prototype.head_observation_revision != observed.head_observation_revision

        prototype.update! \
          branch_deleted_at: Time.current,
          retired_head_sha: prototype.current_build&.commit_sha,
          head_observation_revision: prototype.head_observation_revision + 1
      end
    end
  end

  # Confirms a deletion notification against GitHub, not its delivery order.
  def record_deletion!(branch_name:, configuration:, installation: configuration.installation_snapshot)
    return if record.local?

    observed = observations[branch_name]
    return if observed.nil? || observed.branch_deleted_at.present? || !observed.reviewable?
    return if heads(configuration:, corroborate: [ branch_name ]).key?(branch_name)

    configuration.with_installation!(snapshot: installation) { record_missing!(branch_name:, observed:) }
  end

  # Delayed events may refresh ownership, but only a confirmed current head revives it.
  def refresh!(branch_name:, observed:, configuration:, installation: configuration.installation_snapshot,
    default_branch: record.default_branch)
    sha = current_head(branch_name, configuration:)
    return if sha.nil?

    record_head!(branch_name:, commit_sha: sha, observed:, configuration:, installation:, default_branch:)
  end

  private

  # A shared ancestor is insufficient; the saved head itself must be contained.
  def ancestor?(base, head, configuration:)
    return true if base == head

    comparison = configuration.github_client.repositories.compare \
      record,
      base,
      head,
      token: configuration.tokens.installation
    if !comparison.is_a?(Hash) || !comparison["base_commit"].is_a?(Hash) ||
        comparison["base_commit"]["sha"] != base ||
        !comparison["merge_base_commit"].is_a?(Hash) ||
        !comparison["merge_base_commit"]["sha"].is_a?(String) ||
        !Build::COMMIT_SHA_FORMAT.match?(comparison["merge_base_commit"]["sha"]) ||
        !%w[ahead behind diverged].include?(comparison["status"]) ||
        ((comparison["status"] == "ahead") != (comparison["merge_base_commit"]["sha"] == base)) ||
        (comparison["status"] == "behind" && comparison["merge_base_commit"]["sha"] != head) ||
        (comparison["status"] == "diverged" && comparison["merge_base_commit"]["sha"] == head)
      raise GithubClient::InvalidResponse, "GitHub returned invalid branch ancestry"
    end

    comparison["status"] == "ahead"
  end
end
