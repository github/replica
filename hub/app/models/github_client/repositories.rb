# Calls GitHub APIs for repository permissions and branches.
class GithubClient::Repositories
  # Uses the shared GitHub API transport.
  def initialize(transport)
    @transport = transport
  end

  # Fetches one user's effective permission for an installed repository.
  def permission(repository, user, token:)
    transport.request \
      :get,
      "/repos/#{repository.github_path}/collaborators/#{CGI.escapeURIComponent(user.login)}/permission",
      token:
  end

  # Reads a user's immutable identity, treating only a confirmed missing user as absent.
  def mention_profile(login, token:, github_id: nil)
    path = github_id ? "/user/#{github_id}" : "/users/#{CGI.escapeURIComponent(login)}"
    payload = transport.request(:get, path, token:)
    id = payload.fetch("id")
    current_login = payload.fetch("login")
    unless id.is_a?(Integer) && id.positive? && current_login.is_a?(String) && current_login.present?
      raise GithubClient::InvalidResponse, "GitHub returned an invalid mention identity"
    end

    { github_id: id, login: current_login, avatar_url: payload["avatar_url"] }
  rescue GithubClient::NotFound
    nil
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete mention identity"
  end

  # Lists repository collaborators for suggestions, including inherited repository access.
  def mention_candidates(repository, token:)
    entries = []
    page = 1
    loop do
      payload = transport.request \
        :get,
        "/repos/#{repository.github_path}/collaborators?affiliation=all&per_page=100&page=#{page}",
        token: token

      raise GithubClient::InvalidResponse, "GitHub returned an invalid collaborator list" unless payload.is_a?(Array)

      entries.concat(payload.map do |profile|
        id = profile.fetch("id")
        login = profile.fetch("login")
        unless id.is_a?(Integer) && id.positive? && login.is_a?(String) && login.present?
          raise GithubClient::InvalidResponse, "GitHub returned an invalid collaborator identity"
        end

        { githubId: id, login:, avatarUrl: profile["avatar_url"] }
      end)
      break if payload.length < 100

      page += 1
    end
    entries
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete collaborator list"
  end

  # Fetches independent permissions while retaining each repository's failure.
  def permissions(repositories, user, token:)
    GithubClient::Batch.map(repositories) do |repository|
      [ repository.github_id, permission(repository, user, token:) ]
    rescue GithubClient::Error => error
      [ repository.github_id, error ]
    end.to_h
  end

  # Lists every current branch and head commit in one repository.
  def branches(repository, token:)
    branches = []
    names = Set.new
    page = 1
    loop do
      path = "/repos/#{repository.github_path}/branches?per_page=100&page=#{page}"
      entries = transport.request(:get, path, token:)
      if !entries.is_a?(Array) || entries.length > 100
        raise GithubClient::InvalidResponse, "GitHub returned an invalid branch list"
      end
      entries.each do |entry|
        name = entry["name"] if entry.is_a?(Hash)
        if !name.is_a?(String) || name.strip.empty? || name.length > 255 || !names.add?(name)
          raise GithubClient::InvalidResponse, "GitHub returned an invalid branch list"
        end
      end

      branches.concat(entries)
      break if entries.length < 100

      page += 1
    end
    branches
  end

  # Paginates actual repository activity times, including pushes of old commits.
  def recent_activity(repository, user, token:)
    base_path = "/repos/#{repository.github_path}/activity"
    path = "#{base_path}?#{URI.encode_www_form(actor: user.login, time_period: "day", direction: "desc", per_page: 100)}"
    activities = []
    seen = []
    loop do
      raise GithubClient::InvalidResponse, "GitHub repeated an activity page" if seen.include?(path)

      seen << path
      response = transport.request \
        :get,
        path,
        token:,
        with_headers: true
      entries = response.fetch(:body)
      if !entries.is_a?(Array) || entries.length > 100
        raise GithubClient::InvalidResponse, "GitHub returned an invalid repository activity list"
      end

      activities.concat(entries)
      links = response.fetch(:headers).fetch("link", []).join(",")
      next_url = links.split(",").filter_map do |link|
        link[/<([^>]+)>;\s*rel="next"/, 1]
      end.first
      break if next_url.nil?

      uri = URI.parse(next_url)
      if uri.path != base_path || uri.query.blank?
        raise GithubClient::InvalidResponse, "GitHub returned an invalid activity page"
      end

      path = "#{base_path}?#{uri.query}"
    end
    activities
  rescue URI::InvalidURIError
    raise GithubClient::InvalidResponse, "GitHub returned an invalid activity page"
  end

  # Fetches one exact commit so Hub can retain its author identity.
  def commit(repository, commit_sha, token:)
    if !commit_sha.to_s.match?(Build::COMMIT_SHA_FORMAT)
      raise ArgumentError, "Commit SHA must contain 40 lowercase hexadecimal characters"
    end

    transport.request(:get, "/repos/#{repository.github_path}/commits/#{commit_sha}", token:)
  end

  # Fetches one file at a branch or immutable commit reference.
  def content(repository, path, ref:, token:)
    escaped_path = path.split("/").map { CGI.escapeURIComponent(_1) }.join("/")
    transport.request \
      :get,
      "/repos/#{repository.github_path}/contents/#{escaped_path}?ref=#{CGI.escapeURIComponent(ref)}",
      token:
  end

  # Fetches one exact Git reference.
  def reference(repository, branch, token:)
    escaped_branch = branch.split("/").map { CGI.escapeURIComponent(_1) }.join("/")
    transport.request \
      :get,
      "/repos/#{repository.github_path}/git/ref/heads/#{escaped_branch}",
      token:
  end

  # A missing ref counts as deletion only while the same repository remains readable.
  def confirm_access!(repository, token:)
    payload = transport.request(:get, "/repos/#{repository.github_path}", token:)
    if !payload.is_a?(Hash) || payload["id"] != repository.github_id
      raise GithubClient::InvalidResponse, "GitHub returned invalid repository identity"
    end

    payload
  end

  # Compares two branches so callers can validate every proposed repository change.
  def compare(repository, base, head, token:, page: nil)
    escaped_base = CGI.escapeURIComponent(base)
    escaped_head = CGI.escapeURIComponent(head)
    query = page ? "?per_page=100&page=#{page}" : ""
    transport.request \
      :get,
      "/repos/#{repository.github_path}/compare/#{escaped_base}...#{escaped_head}#{query}",
      token:
  end

  # Creates one branch at an exact commit.
  def create_reference(repository, branch, commit_sha, token:)
    transport.request \
      :post,
      "/repos/#{repository.github_path}/git/refs",
      token:,
      body: { ref: "refs/heads/#{branch}", sha: commit_sha },
      expected_status: [ 201 ]
  end

  # Creates one new file without replacing existing repository content.
  def create_file(repository, path, content, branch:, message:, token:)
    escaped_path = path.split("/").map { CGI.escapeURIComponent(_1) }.join("/")
    transport.request \
      :put,
      "/repos/#{repository.github_path}/contents/#{escaped_path}",
      token:,
      body: {
        message:,
        content: Base64.strict_encode64(content),
        branch:
      },
      expected_status: [ 201 ]
  end

  # Updates one existing file at its exact Git blob identity.
  def update_file(repository, path, content, sha:, branch:, message:, token:)
    escaped_path = path.split("/").map { CGI.escapeURIComponent(_1) }.join("/")
    transport.request \
      :put,
      "/repos/#{repository.github_path}/contents/#{escaped_path}",
      token:,
      body: {
        message:,
        content: Base64.strict_encode64(content),
        sha:,
        branch:
      },
      expected_status: [ 200 ]
  end

  private

  attr_reader :transport
end
