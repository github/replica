# Checks current branches before offering them for registration.
class Repository::PrototypeCandidates < ActiveRecord::AssociatedObject
  CANDIDATES_PER_PAGE = 10

  # Paginates eligible branches, leaving registration checks fresh.
  def available_page(permission:, page: 1, configuration: GithubAppConfiguration.current)
    return [ [], 0 ] if !record.authorization.sufficient?(permission, minimum: :write)

    candidates = candidate_branches.to_a
    return [ [], 0 ] if candidates.empty?

    heads = current_heads(configuration:)
    eligible = candidates.select do |prototype|
      eligible?(prototype, permission:, heads:)
    end
    page_count = (eligible.size + CANDIDATES_PER_PAGE - 1) / CANDIDATES_PER_PAGE
    [ eligible.slice((page - 1) * CANDIDATES_PER_PAGE, CANDIDATES_PER_PAGE) || [], page_count ]
  end

  # Uses GitHub pushes by this person or local head observations, never commit dates.
  def recently_active_by(user, permission:)
    return [] if !record.authorization.sufficient?(permission, minimum: :write)

    candidates = candidate_branches.where.not \
      id: user.branch_banner_dismissals.select(:prototype_id)

    if record.local?
      return [] if !record.authorization.authorized?(user, minimum: :write)

      now = Time.current
      candidates = candidates
        .where("local_head_observed_at > ? AND local_head_observed_at <= ?", now - 12.hours, now).to_a
      heads = current_heads
      return candidates.select { |prototype| eligible?(prototype, permission:, heads:) }
    end

    candidates = candidates.to_a
    return [] if candidates.empty?

    configuration = GithubAppConfiguration.current
    raise GithubClient::InvalidResponse, "GitHub App is not configured" if configuration.nil?

    activities = configuration.github_client.repositories.recent_activity \
      record,
      user,
      token: configuration.tokens.installation
    now = Time.current
    branches = activities.filter_map do |activity|
      if !activity.is_a?(Hash)
        raise GithubClient::InvalidResponse, "GitHub returned an invalid repository activity"
      end
      next if !%w[push force_push branch_creation].include?(activity["activity_type"])

      timestamp = activity.fetch("timestamp")
      actor = activity.fetch("actor")
      ref = activity.fetch("ref")
      if !timestamp.is_a?(String) || !ref.is_a?(String) || (!actor.nil? && !actor.is_a?(Hash))
        raise GithubClient::InvalidResponse, "GitHub returned an invalid push activity"
      end

      timestamp = Time.iso8601(timestamp)
      next if timestamp <= now - 12.hours || timestamp > now || actor&.fetch("id") != user.github_id
      next if !ref.start_with?("refs/heads/")

      ref.delete_prefix("refs/heads/")
    end.uniq
    candidates.select! { |prototype| branches.include?(prototype.branch_name) }
    return [] if candidates.empty?

    heads = current_heads
    candidates.select { |prototype| eligible?(prototype, permission:, heads:) }
  rescue KeyError, TypeError, ArgumentError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete push activity"
  end

  # Rechecks one branch at registration, independent of the page's filtered list.
  def eligible?(prototype, permission:, heads: nil)
    registration_ineligibility_reason(prototype, permission:, heads:).nil?
  end

  # Explains the first failed registration check without changing eligibility.
  def registration_ineligibility_reason(prototype, permission:, heads: nil)
    return "write_access_required" if !record.authorization.sufficient?(permission, minimum: :write)
    return "repository_mismatch" if prototype.repository_id != record.id
    return "remote_branch_missing" if prototype.branch_deleted_at.present?
    return "already_registered" if prototype.registered?
    return "branch_not_reviewable" unless prototype.reviewable?

    heads ||= current_heads
    return "remote_branch_missing" if heads[prototype.branch_name].nil?

    nil
  end

  private

  # Excludes base and reserved branches before any eligibility requests.
  def candidate_branches
    record.reviewable_prototypes.active.unregistered.order(:branch_name)
  end

  # Uses current heads, not persisted Builds, to exclude deleted and moved branches.
  def current_heads(configuration: GithubAppConfiguration.current)
    if record.local?
      refs = Repository::LocalDiscovery.git!("-C", record.local_path, "for-each-ref",
        "--format=%(refname:short) %(objectname)", "refs/heads")
      return refs.each_line.to_h { |line| line.strip.split(" ", 2) }
    end

    raise GithubClient::InvalidResponse, "GitHub App is not configured" if configuration.nil?

    configuration.github_client.repositories.branches(
      record, token: configuration.tokens.installation
    ).to_h do |branch|
      if !branch.is_a?(Hash) || !branch["commit"].is_a?(Hash)
        raise GithubClient::InvalidResponse, "GitHub returned an invalid branch head"
      end

      name = branch.fetch("name")
      sha = branch.fetch("commit").fetch("sha")
      if !name.is_a?(String) || !sha.is_a?(String) ||
          !sha.match?(Build::COMMIT_SHA_FORMAT)
        raise GithubClient::InvalidResponse, "GitHub returned an invalid branch head"
      end

      [ name, sha ]
    end
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete branch head"
  end
end
