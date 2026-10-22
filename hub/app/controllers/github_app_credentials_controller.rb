# Accepts replacement credentials without exporting saved secrets.
class GithubAppCredentialsController < SuperglueController
  include HasGithubAppAdministration

  before_action :authorize_admin
  before_action :load_configuration
  before_action :confirm_change, only: :update
  before_action :authorize_replacement, only: :update

  # @route GET /github_app/credentials (edit_github_app_credentials)
  def edit
    record_security_audit(outcome: "succeeded")
  end

  # @route PATCH /github_app/credentials (github_app_credentials)
  def update
    private_key = if @continued_action_parameters
      @continued_action_parameters.fetch("private_key")
    else
      upload = params[:private_key]
      limit = GithubAppConfiguration::Administration::PRIVATE_KEY_LIMIT
      if !upload.is_a?(ActionDispatch::Http::UploadedFile) || upload.size > limit
        raise GithubAppConfiguration::Administration::InvalidCredentials, "Invalid replacement credentials"
      end

      upload.read(limit + 1)
    end

    @configuration.administration.replace_credentials! \
      actor: Current.user, browser_session: Current.session, expected_version: @expected_version,
      client_secret: params[:client_secret], private_key: private_key
    @security_audit_recorded = true
    redirect_to github_app_path, notice: t("github_app.credentials.saved"), status: :see_other
  end

  private

  # Recheck the persisted role, not a cached user or App-owner identity.
  def authorize_admin
    return if User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists? &&
      !LocalDevelopment.enabled?

    deny_admin_access
  end

  def authorize_replacement
    require_fresh_authorization \
      purpose: :github_app_credentials, return_to: edit_github_app_credentials_path
  end

  def security_audit_action
    action_name == "update" ? "github_app.rotate_credentials" : "github_app.view"
  end
end
