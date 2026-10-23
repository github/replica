# Provides grouped access to GitHub's APIs through shared HTTP transports.
class GithubClient
  class Error < StandardError
    attr_reader :response, :status

    # Records GitHub's HTTP status and decoded error response when they are available.
    def initialize(message, status: nil, response: nil)
      @status = status
      @response = response
      super(message)
    end
  end

  class InvalidResponse < Error; end
  class NotFound < Error; end
  class Forbidden < Error; end
  class Gone < Error; end
  class RateLimited < Error; end
  class DownloadTooLarge < InvalidResponse; end

  # Creates API groups that share the configured GitHub transports.
  def initialize(
    api_url: Rails.configuration.x.github_api_url,
    github_url: Rails.configuration.x.github_url,
    api_version: Rails.configuration.x.github_api_version
  )
    @api_transport = Transport.new(base_url: api_url, api_version:)
    @oauth_transport = Transport.new(base_url: github_url, api_version: nil)
  end

  # Returns GitHub App API operations.
  def apps
    @apps ||= Apps.new(@api_transport)
  end

  # Returns metadata-only App webhook recovery operations.
  def webhook_deliveries
    @webhook_deliveries ||= WebhookDeliveries.new(@api_transport)
  end

  # Returns GitHub App installation API operations.
  def installations
    @installations ||= Installations.new(@api_transport)
  end

  # Returns repository API operations.
  def repositories
    @repositories ||= Repositories.new(@api_transport)
  end

  # Returns pull request API operations.
  def pull_requests
    @pull_requests ||= PullRequests.new(@api_transport)
  end

  # Returns GitHub Actions API operations.
  def actions
    @actions ||= Actions.new(@api_transport)
  end

  # Returns GitHub OAuth API operations.
  def oauth
    @oauth ||= Oauth.new(api_transport: @api_transport, oauth_transport: @oauth_transport)
  end
end
