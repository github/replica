# Checks current branches before offering them for registration.
class Repository::PrototypeCandidates < ActiveRecord::AssociatedObject
  AUTHOR_CACHE_TTL = 5.minutes
  COMPARE_PAGE_SIZE = 100
  CANDIDATES_PER_PAGE = 10

  # Paginates eligible branches, leaving registration checks fresh.
  def available_page(user, permission:, page: 1, configuration: GithubAppConfiguration.current)
    return [ [], 0 ] if !record.authorization.sufficient?(permission, minimum: :write)

    candidates = candidate_branches.to_a
    return [ [], 0 ] if candidates.empty?

    heads = current_heads(configuration:)
    authors = if !record.local? && !record.authorization.sufficient?(permission, minimum: :admin)
      warm_authors(candidates, heads, configuration:)
    end
    eligible = candidates.select do |prototype|
      eligible?(prototype, user, permission:, heads:, authors:)
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
      return candidates.select { |prototype| eligible?(prototype, user, permission:, heads:) }
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
    candidates.select { |prototype| eligible?(prototype, user, permission:, heads:) }
  rescue KeyError, TypeError, ArgumentError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete push activity"
  end

  # Rechecks one branch at registration, independent of the page's filtered list.
  def eligible?(prototype, user, permission:, heads: nil, fresh: false, authors: nil)
    registration_ineligibility_reason(prototype, user, permission:, heads:, fresh:, authors:).nil?
  end

  # Explains the first failed registration check without changing eligibility.
  def registration_ineligibility_reason(prototype, user, permission:, heads: nil, fresh: false, authors: nil)
    return "write_access_required" if !record.authorization.sufficient?(permission, minimum: :write)
    return "repository_mismatch" if prototype.repository_id != record.id
    return "remote_branch_missing" if prototype.branch_deleted_at.present?
    return "already_registered" if prototype.registered?
    return "branch_not_reviewable" unless prototype.reviewable?

    heads ||= current_heads
    head = heads[prototype.branch_name]
    return "remote_branch_missing" if head.nil?
    return if record.authorization.sufficient?(permission, minimum: :admin)

    default_head = heads[record.default_branch]
    raise GithubClient::InvalidResponse, "GitHub omitted the default branch" if default_head.nil?

    ids = authors && !fresh ? authors.fetch(head) : author_ids(default_head, head, fresh:)
    "branch_authorship_required" unless ids.include?(user.github_id)
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

  # Shares immutable comparisons between gallery, management, and registration.
  def author_ids(base, head, fresh:)
    return compare_authors(base, head) if fresh

    Rails.cache.fetch(
      author_cache_key(base, head),
      expires_in: AUTHOR_CACHE_TTL
    ) { compare_authors(base, head) }
  end

  # Retains successful comparisons on this thread before surfacing any batch failure.
  def warm_authors(candidates, heads, configuration:)
    base = heads[record.default_branch]
    raise GithubClient::InvalidResponse, "GitHub omitted the default branch" if base.nil?

    live_heads = candidates.filter_map { heads[_1.branch_name] }.uniq
    cached = Rails.cache.read_multi(*live_heads.map { author_cache_key(base, _1) })
    missing = live_heads.reject { cached.key?(author_cache_key(base, _1)) }
    if missing.any?
      token = configuration.tokens.installation
      failures = Queue.new
      comparisons = GithubClient::Batch.map(missing) do |head|
        next if !failures.empty?

        [ head, compare_authors(base, head, configuration:, token:) ]
      rescue GithubClient::Error => error
        failures << error
        nil
      end
      comparisons.compact.each do |head, authors|
        cached[author_cache_key(base, head)] = authors
        Rails.cache.write(author_cache_key(base, head), authors, expires_in: AUTHOR_CACHE_TTL)
      end
      raise failures.pop if !failures.empty?
    end
    live_heads.to_h { |head| [ head, cached.fetch(author_cache_key(base, head)) ] }
  end

  # Separates comparisons by the exact default and branch commits.
  def author_cache_key(base, head)
    [ "prototype-branch-authors", record.github_id, base, head ]
  end

  # Paginates the entire branch-only history; the latest Build author is not enough.
  def compare_authors(base, head, configuration: GithubAppConfiguration.current, token: nil)
    raise GithubClient::InvalidResponse, "GitHub App is not configured" if configuration.nil?

    token ||= configuration.tokens.installation
    authors = []
    seen = 0
    page = 1
    loop do
      comparison = configuration.github_client.repositories.compare(
        record, base, head, token:, page:
      )
      if !comparison.is_a?(Hash)
        raise GithubClient::InvalidResponse, "GitHub returned an incomplete branch comparison"
      end

      total = comparison.fetch("total_commits")
      commits = comparison.fetch("commits")
      if !total.is_a?(Integer) || total.negative? || !commits.is_a?(Array) ||
          commits.length > COMPARE_PAGE_SIZE || (commits.empty? && seen < total)
        raise GithubClient::InvalidResponse, "GitHub returned an incomplete branch comparison"
      end

      commits.each do |commit|
        if !commit.is_a?(Hash)
          raise GithubClient::InvalidResponse, "GitHub returned an invalid commit author"
        end

        author = commit.fetch("author")
        if !author.nil? && !author.is_a?(Hash)
          raise GithubClient::InvalidResponse, "GitHub returned an invalid commit author"
        end

        id = author&.fetch("id", nil)
        if !id.nil? && (!id.is_a?(Integer) || id <= 0)
          raise GithubClient::InvalidResponse, "GitHub returned an invalid commit author"
        end

        authors << id if id
      end
      seen += commits.length
      if seen > total || (seen < total && commits.length < COMPARE_PAGE_SIZE)
        raise GithubClient::InvalidResponse, "GitHub returned an incomplete branch comparison"
      end
      break if seen == total

      page += 1
    end
    authors.uniq
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete branch comparison"
  end
end
