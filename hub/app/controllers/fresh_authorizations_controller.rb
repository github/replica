# Verifies identity, then returns confirmed actions to their CSRF-protected routes.
class FreshAuthorizationsController < SuperglueController
  allow_unauthenticated_access
  before_action :resume_session
  before_action -> { enforce_security_rate_limit(:oauth_initiation, identity: trusted_request_ip) }, only: :create
  before_action :load_challenge
  before_action { response.headers["Cache-Control"] = "private, no-store" }

  rescue_from FreshAuthorization::Invalid, with: :authorization_failed
  rescue_from ActiveRecord::RecordNotFound, with: :authorization_failed

  # @route GET /authorization/:id (fresh_authorization)
  def show
    @continuing = @challenge.continuation.available_to?(Current.session)
    raise FreshAuthorization::Invalid if !@continuing && !@challenge.available_to?(Current.session)
  end

  # @route POST /authorization/:id (fresh_authorization)
  def create
    configuration = GithubAppConfiguration.current
    raise FreshAuthorization::Invalid if configuration.nil? || LocalDevelopment.enabled?

    pending = {}
    url = configuration.oauth.authorize_url(pending)
    @challenge.bind_oauth!(pending.fetch(:github_oauth_state), browser_session: Current.session)
    pending[:fresh_authorization_id] = @challenge.id
    session.delete(:hub_admin_enrollment_proof)
    session.update(pending)
    response.location = url
    head :see_other
  end

  # @route DELETE /authorization/:id (fresh_authorization)
  def destroy
    @challenge.cancel!(browser_session: Current.session)
    discard_challenge_flow
    redirect_to @challenge.return_to, alert: t("fresh_authorization.cancelled"), status: :see_other
  end

  private

  def load_challenge
    @challenge = FreshAuthorization.find_by!(public_id: params[:id])
  end

  def authorization_failed
    if action_name != "show"
      if @challenge
        @challenge.audit!("denied")
      else
        SecurityAuditEvent.record!(action: "fresh_authorization.verify", outcome: "denied")
      end
    end
    redirect_to root_path, alert: t("fresh_authorization.failure"), status: :see_other
  end

  # Cancellation clears only its own bundle, even if the App has been removed.
  def discard_challenge_flow
    return if session[:fresh_authorization_id] != @challenge.id

    %i[fresh_authorization_id github_oauth_state github_oauth_verifier github_oauth_started_at
      github_oauth_generation github_oauth_configuration_id github_oauth_credential_revision].each do |key|
      session.delete(key)
    end
  end
end
