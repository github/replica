# Provides the one-time, bootstrap-secret-protected GitHub App setup flow.
class GithubAppSetupController < SuperglueController
  allow_unauthenticated_access
  before_action :disable_for_local_mode
  before_action :resume_session
  before_action -> { enforce_security_rate_limit(:github_app_setup, identity: trusted_request_ip) }, only: :create

  rescue_from GithubAppSetup::Error, with: :setup_not_found
  rescue_from GithubClient::Error, with: :setup_not_found
  rescue_from GithubAppConfiguration::Installation::OwnerMismatch, with: :setup_not_found
  rescue_from GithubAppConfiguration::Superseded, ActiveRecord::StaleObjectError, with: :setup_not_found

  # @route GET /setup (setup)
  def show
    if setup.authorized?
      @registration = setup.registration
      render :register
    end
  end

  # @route POST /setup (setup)
  def create
    setup.authorize!(params[:bootstrap_secret], organization: params[:organization])
    redirect_to setup_path
  end

  # @route GET /setup/callback (callback_setup)
  def callback
    configuration = setup.exchange!(code: params[:code], state: params[:state])
    redirect_to \
      "#{Rails.configuration.x.github_url}/apps/#{configuration.app_slug}/installations/new",
      allow_other_host: true
  end

  # @route GET /setup/install (install_setup)
  def install
    return setup_not_found if !setup.installation_authorized?

    configuration = GithubAppConfiguration.current
    return setup_not_found if configuration.nil?
    configuration.installation.install!(params.require(:installation_id))
    setup.finish_installation!
  end

  private

  def security_audit_action
    {
      "create" => "github_app_setup.authorize",
      "callback" => "github_app_setup.exchange",
      "install" => "github_app_setup.install"
    }[action_name]
  end

  # Local mode never provisions a GitHub App.
  def disable_for_local_mode
    head :not_found if LocalDevelopment.enabled?
  end

  def setup
    @setup ||= GithubAppSetup.new \
      session:,
      bootstrap_secret: ENV.fetch("REPLICA_BOOTSTRAP_SECRET", "")
  end

  def setup_not_found(_error = nil)
    head :not_found
  end
end
