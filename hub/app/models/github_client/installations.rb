# Calls GitHub APIs for App installations and their repositories.
class GithubClient::Installations
  # Uses the shared GitHub API transport.
  def initialize(transport)
    @transport = transport
  end

  # Fetches one GitHub App installation.
  def get(id, token:)
    transport.request(:get, "/app/installations/#{id.to_i}", token:)
  end

  # Finds this App's installation in its current owner's account.
  def for_account(login:, type:, token:)
    unless %w[Organization User].include?(type) &&
        login.is_a?(String) && login.match?(/\A[A-Za-z0-9][A-Za-z0-9-]*\z/)
      raise GithubClient::InvalidResponse, "GitHub returned an invalid installation account"
    end

    scope = type == "Organization" ? "orgs" : "users"
    transport.request(:get, "/#{scope}/#{CGI.escape(login)}/installation", token:)
  end

  # Creates one access token for a GitHub App installation, limited to the given permissions when
  # there are any.
  def create_token(id, token:, permissions: nil)
    body = { permissions: } if permissions
    transport.request(:post, "/app/installations/#{id.to_i}/access_tokens", token:, body:)
  end

  # Lists every repository available to a GitHub App installation.
  def repositories(token:)
    repositories = []
    page = 1
    loop do
      batch = transport.request(:get, "/installation/repositories?per_page=100&page=#{page}", token:)
      entries = batch.fetch("repositories")
      repositories.concat(entries)
      break if entries.length < 100

      page += 1
    end
    repositories
  rescue KeyError, TypeError
    raise GithubClient::InvalidResponse, "GitHub returned an incomplete repository list"
  end

  private

  attr_reader :transport
end
