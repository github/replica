# Provides the one-time, bootstrap-secret-protected GitHub App setup flow.
class GithubAppSetupController < SuperglueController
  allow_unauthenticated_access
  before_action :disable_for_local_mode
  before_action :resume_session

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

  # Shows the manual registration checklist only after bootstrap authorization.
  # @route GET /setup/manual (manual_setup)
  def manual
    return setup_not_found if !setup.authorized? || GithubAppConfiguration.configured?

    @registration = { manifest: setup.registration_manifest }
  end

  # Connects an independently registered App without changing its GitHub settings.
  # @route POST /setup/manual (setup_manual)
  def import
    return setup_not_found if !setup.authorized? || GithubAppConfiguration.configured?

    upload = params[:private_key]
    limit = GithubAppConfiguration::Administration::PRIVATE_KEY_LIMIT
    unless upload.is_a?(ActionDispatch::Http::UploadedFile) && upload.size <= limit
      return manual_error(t("github_app_setup.manual.invalid_key"))
    end

    setup.import! \
      app_id: params[:app_id], client_id: params[:client_id],
      client_secret: params[:client_secret], private_key: upload.read(limit + 1),
      webhook_secret: params[:webhook_secret], installation_id: params[:installation_id],
      confirmed: params[:confirmed]
    session[:github_app_manual_completed_at] = Time.current.to_i
    redirect_to install_setup_path, status: :see_other
  rescue GithubAppSetup::Error, GithubClient::Error,
    GithubAppConfiguration::Installation::OwnerMismatch
    manual_error(t("github_app_setup.manual.failed"))
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
    completed_at = session.delete(:github_app_manual_completed_at)
    if completed_at && Time.current.to_i - completed_at.to_i <= GithubAppSetup::MAXIMUM_AGE &&
        GithubAppConfiguration.configured?
      @manual_connection = true
      return render :install
    end

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
      "import" => "github_app_setup.import",
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

  def manual_error(message)
    @setup_error = message
    @registration = { manifest: setup.registration_manifest }
    render :manual, status: :unprocessable_entity
  end
end
