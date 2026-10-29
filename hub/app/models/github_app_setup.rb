# Creates or explicitly imports this Hub's verified GitHub App connection.
class GithubAppSetup
  MAXIMUM_AGE = 15.minutes
  MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807

  class Error < StandardError; end
  class ImportError < Error
    attr_reader :reason

    # Exposes only fixed reasons without leaking credentials or GitHub responses.
    def initialize(reason)
      @reason = reason
      super(reason.to_s)
    end
  end

  class InvalidState < Error; end
  class ExchangeFailed < Error; end

  # Stores the browser session and deployment settings used during setup.
  def initialize(session:, bootstrap_secret:, clock: -> { Time.current }, exchanger: nil)
    @session = session
    @bootstrap_secret = bootstrap_secret.to_s
    @clock = clock
    @exchanger = exchanger
  end

  # Checks the bootstrap secret and starts a short-lived setup session.
  def authorize!(submitted_secret, organization: nil)
    reject_if_configured!
    raise InvalidState, "Setup is unavailable" if bootstrap_secret.empty?

    expected = OpenSSL::Digest::SHA256.hexdigest(bootstrap_secret)
    submitted = OpenSSL::Digest::SHA256.hexdigest(submitted_secret.to_s)
    raise InvalidState, "Invalid bootstrap secret" if !secure_compare(expected, submitted)

    organization = organization.to_s.strip
    if organization.present? && !organization.match?(/\A[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\z/)
      raise InvalidState, "Invalid organization login"
    end

    session[:github_app_setup_authorized] = clock.call.to_i
    session[:github_app_setup_organization] = organization.presence
    SecurityAuditEvent.record!(action: "github_app_setup.authorize", outcome: "succeeded")
  end

  # Reports whether the browser may continue GitHub App setup.
  def authorized?
    authorized_at = session[:github_app_setup_authorized]
    authorized_at.present? && clock.call.to_i - authorized_at.to_i <= MAXIMUM_AGE
  end

  # Returns the settings shared by browser registration and manual setup.
  def registration_manifest
    raise InvalidState, "Setup authorization expired" if !authorized?

    reject_if_configured!
    manifest
  end

  # Builds the GitHub App settings and one-time request state.
  def registration
    manifest = registration_manifest

    state = SecureRandom.urlsafe_base64(32)
    session[:github_app_manifest_state] = state
    session[:github_app_manifest_state_created_at] = clock.call.to_i
    { url: "#{registration_url}?state=#{CGI.escape(state)}", manifest: }
  end

  # Trades GitHub's one-time code for App credentials and saves them.
  def exchange!(code:, state:)
    verify_state!(state)
    clear_state!
    payload = exchanger ? exchanger.call(code) : exchange(code)
    configuration = GithubAppConfiguration.install!(attributes(payload))
    session.delete(:github_app_setup_authorized)
    session.delete(:github_app_setup_organization)
    session[:github_app_install_authorized] = clock.call.to_i
    configuration
  end

  # Imports only an authenticated App and one explicitly confirmed active installation.
  def import!(app_id:, client_id:, client_secret:, private_key:, webhook_secret:, installation_id:, confirmed:)
    raise InvalidState, "Setup is unavailable in local mode" if LocalDevelopment.enabled?
    raise InvalidState, "Setup authorization expired" if !authorized?

    reject_if_configured!
    raise InvalidState, "Confirm the GitHub App connection" if confirmed != "1"

    limits = GithubAppConfiguration::Administration
    valid = [ app_id, installation_id ].all? do |value|
      value.to_s.match?(/\A[0-9]{1,19}\z/) && value.to_i.between?(1, MAX_SIGNED_BIGINT)
    end
    valid &&= \
      client_id.is_a?(String) && client_id.present? && client_id.bytesize <= 255 &&
      [ client_secret, webhook_secret ].all? do |secret|
        secret.is_a?(String) && secret.present? && secret.bytesize <= limits::CLIENT_SECRET_LIMIT
      end
    valid &&= private_key.is_a?(String) && private_key.present? && private_key.bytesize <= limits::PRIVATE_KEY_LIMIT
    raise ImportError, :invalid_credentials if !valid

    key = OpenSSL::PKey::RSA.new(private_key)
    raise ImportError, :invalid_private_key if !key.private?

    candidate = GithubAppConfiguration.new \
      github_app_id: app_id.to_i, client_id:, client_secret:, private_key:, webhook_secret:,
      installation_policy: "pinned", installation_id: installation_id.to_i
    app = begin
      candidate.github_client.apps.get(token: candidate.tokens.app)
    rescue GithubClient::Error => error
      reason = error.is_a?(GithubClient::Forbidden) ? :github_authentication_failed : :github_failed
      raise ImportError, reason
    end
    owner = candidate.ownership.attributes_for(app)
    raise ImportError, :app_mismatch if app["client_id"] != client_id

    candidate.assign_attributes(owner)
    payload = candidate.github_client.installations.get(candidate.installation_id, token: candidate.tokens.app)
    candidate.installation.verify_import!(payload)
    account = payload.fetch("account")
    candidate.assign_attributes \
      installation_account_github_id: account.fetch("id"),
      installation_account_login: account.fetch("login"),
      installation_owner_type: account.fetch("type"),
      installation_state: "active", installed_at: clock.call, installation_checked_at: clock.call
    token = candidate.tokens.for_installation(candidate.installation_id)
    repositories = candidate.repositories.snapshot(token:)
    configuration = GithubAppConfiguration.transaction do
      raise InvalidState, "Setup authorization expired" if !authorized?

      reject_if_configured!
      saved = GithubAppConfiguration.install!(candidate.attributes.except("id", "created_at", "updated_at"))
      saved.repositories.synchronize!(snapshot: repositories)
      saved
    end
    clear_state!
    session.delete(:github_app_setup_authorized)
    session.delete(:github_app_setup_organization)
    session.delete(:github_app_install_authorized)
    configuration
  rescue OpenSSL::PKey::RSAError
    raise ImportError, :invalid_private_key
  rescue ArgumentError, TypeError
    raise ImportError, :invalid_credentials
  rescue GithubClient::Error, GithubAppConfiguration::Installation::OwnerMismatch
    raise ImportError, :github_failed
  rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
    raise ImportError, :save_failed
  end

  # Reports whether the browser may finish installing the new App.
  def installation_authorized?
    authorized_at = session[:github_app_install_authorized]
    authorized_at.present? && clock.call.to_i - authorized_at.to_i <= MAXIMUM_AGE
  end

  # Ends the browser's temporary permission to finish App installation.
  def finish_installation!
    session.delete(:github_app_install_authorized)
  end

  private

  attr_reader :bootstrap_secret, :clock, :exchanger, :session

  # Builds the App settings submitted to GitHub.
  def manifest
    origin = hub_origin
    attributes = {
      name: "Replica Hub", url: origin, description: "Build and review prototype branches.",
      redirect_url: "#{origin}/setup/callback", callback_urls: [ "#{origin}/auth/github/callback" ],
      setup_url: "#{origin}/setup/install", setup_on_update: false,
      request_oauth_on_install: false, public: false,
      default_permissions: {
        actions: "read",
        administration: "read",
        contents: "write",
        pull_requests: "write",
        workflows: "write"
      }
    }
    if public_origin?
      attributes[:hook_attributes] = { url: "#{origin}/github/webhooks", active: true }
      attributes[:default_events] = %w[push workflow_run]
    end

    JSON.generate(attributes)
  end

  # Confirms GitHub returned the same fresh, one-time state Hub created.
  def verify_state!(submitted)
    expected = session[:github_app_manifest_state].to_s
    created_at = session[:github_app_manifest_state_created_at]
    fresh = created_at.present? && clock.call.to_i - created_at.to_i <= MAXIMUM_AGE
    matches = expected.present? && secure_compare(expected, submitted.to_s)
    raise InvalidState, "Invalid or expired setup state" if !fresh || !matches
  end

  # Requests the new App's credentials from GitHub.
  def exchange(code)
    github_client.apps.manifest(code)
  rescue GithubClient::InvalidResponse
    raise ExchangeFailed, "GitHub returned invalid setup credentials"
  rescue GithubClient::Error => error
    raise ExchangeFailed, "GitHub setup request failed: #{error.message}"
  end

  # Converts GitHub's response into attributes Hub can safely store.
  def attributes(payload)
    owner = payload.fetch("owner")
    {
      github_app_id: payload.fetch("id").to_i, app_slug: payload.fetch("slug"),
      client_id: payload.fetch("client_id"), client_secret: payload.fetch("client_secret"),
      webhook_secret: payload["webhook_secret"].presence || SecureRandom.urlsafe_base64(48),
      private_key: payload.fetch("pem"),
      owner_github_id: owner.fetch("id").to_i, owner_login: owner.fetch("login"),
      owner_type: owner.fetch("type")
    }
  rescue KeyError, TypeError, ArgumentError
    raise ExchangeFailed, "GitHub returned incomplete setup credentials"
  end

  # Removes one-time manifest state after GitHub returns it.
  def clear_state!
    session.delete(:github_app_manifest_state)
    session.delete(:github_app_manifest_state_created_at)
  end

  # Prevents a second GitHub App from replacing the configured App.
  def reject_if_configured!
    raise InvalidState, "Setup is unavailable" if GithubAppConfiguration.configured?
  end

  # Compares secrets in constant time.
  def secure_compare(left, right)
    left.bytesize == right.bytesize && ActiveSupport::SecurityUtils.secure_compare(left, right)
  end

  # Returns the shared transport for GitHub API requests.
  def github_client
    @github_client ||= GithubClient.new
  end

  # Returns the configured base URL for GitHub browser pages.
  def github_url = Rails.configuration.x.github_url.delete_suffix("/")

  # Returns the public Hub URL used in App settings.
  def hub_origin = Rails.configuration.x.hub_origin.delete_suffix("/")

  # Reports whether GitHub can send webhooks to the configured Hub URL.
  def public_origin?
    uri = URI(hub_origin)
    uri.scheme == "https" && !%w[localhost 127.0.0.1 ::1].include?(uri.hostname)
  end

  # Returns the GitHub page that creates the App for the selected owner.
  def registration_url
    organization = session[:github_app_setup_organization]
    return "#{github_url}/settings/apps/new" if organization.blank?

    "#{github_url}/organizations/#{CGI.escapeURIComponent(organization)}/settings/apps/new"
  end
end
