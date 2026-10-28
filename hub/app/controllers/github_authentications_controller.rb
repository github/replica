# Starts GitHub OAuth and turns an admitted identity into a browser session.
class GithubAuthenticationsController < ApplicationController
  allow_unauthenticated_access
  before_action -> { enforce_security_rate_limit(:oauth_initiation, identity: trusted_request_ip) }, only: :create
  before_action -> { enforce_security_rate_limit(:oauth_callback, identity: trusted_request_ip) }, only: :callback

  # @route POST /auth/github (github_authentication)
  def create
    return head :not_found if LocalDevelopment.enabled?

    configuration = GithubAppConfiguration.current
    return authentication_failed if configuration.nil?

    pending = {}
    url = configuration.oauth.authorize_url(pending)
    session.delete(:hub_admin_enrollment_proof)
    session.delete(:fresh_authorization_id)
    session.update(pending)
    response.location = url
    head :found
  end

  # @route GET /auth/github/callback (github_authentication_callback)
  def callback
    return head :not_found if LocalDevelopment.enabled?

    return fresh_authorization_callback if session[:fresh_authorization_id].present?

    configuration = GithubAppConfiguration.current
    return authentication_failed if configuration.nil?

    enrollment = session[:hub_admin_enrollment_proof].present?
    generation = session[:github_oauth_generation]
    snapshot = configuration.oauth.credential_snapshot!(session)
    user = configuration.oauth.authenticate!(session, code: params[:code], state: params[:state])
    return_to = authentication_return_to
    start_new_session_for(user, fresh_authorized_at: Time.current, generation:, **snapshot)
    show_welcome = user.consume_welcome_sign_in!
    redirect_to return_to || (show_welcome ? welcome_path : repositories_path)
  rescue SessionRevocation::Superseded
    if enrollment && user.nil?
      SecurityAuditEvent.record!(action: "hub_admin.enroll", outcome: "denied", actor: nil)
    end
    reset_session
    redirect_to root_path, alert: t("authentication.sessions_ended"), status: :see_other
  rescue User::RepositoryAccessDenied
    access_denied
  rescue User::AdmissionDenied,
    GithubAppConfiguration::Oauth::InvalidState,
    GithubAppConfiguration::Superseded,
    HubAdminEnrollment::InvalidProof,
    GithubClient::Forbidden
    if enrollment
      SecurityAuditEvent.record!(action: "hub_admin.enroll", outcome: "denied", actor: nil)
    end
    authentication_failed
  rescue GithubClient::Error
    if enrollment
      SecurityAuditEvent.record!(action: "hub_admin.enroll", outcome: "failed", actor: nil)
    end
    authentication_failed
  ensure
    discard_oauth_flow
  end

  private

  # Uses the existing callback without rotating or unlocking another browser Session.
  def fresh_authorization_callback
    response.headers["Cache-Control"] = "private, no-store"
    resume_session
    challenge = FreshAuthorization.find_by(id: session.delete(:fresh_authorization_id))
    raise FreshAuthorization::Invalid if challenge.nil?

    challenge.claim!(state: params[:state], browser_session: Current.session)
    configuration = GithubAppConfiguration.current
    raise FreshAuthorization::Invalid if configuration.nil? || params[:error].present?

    generation = session[:github_oauth_generation]
    snapshot = configuration.oauth.credential_snapshot!(session)
    profile = configuration.oauth.verified_profile!(session, code: params[:code], state: params[:state])
    SessionRevocation.with_generation!(generation) do
      GithubAppConfiguration.with_credentials!(**snapshot) { challenge.verify!(profile) }
    end
    if challenge.pending_action.present?
      redirect_to fresh_authorization_path(challenge.public_id), status: :see_other
    else
      redirect_to challenge.return_to, notice: t("fresh_authorization.succeeded"), status: :see_other
    end
  rescue FreshAuthorization::Invalid, GithubAppConfiguration::Oauth::InvalidState,
    SessionRevocation::Superseded, GithubAppConfiguration::Superseded, ActiveRecord::RecordNotFound
    if challenge
      challenge.continuation.discard!
      challenge.audit!("denied")
    else
      SecurityAuditEvent.record!(action: "fresh_authorization.verify", outcome: "denied")
    end
    redirect_to root_path, alert: t("fresh_authorization.failure"), status: :see_other
  rescue GithubClient::Error
    challenge&.continuation&.discard!
    challenge&.audit!("failed")
    redirect_to root_path, alert: t("fresh_authorization.failure"), status: :see_other
  ensure
    discard_oauth_flow
  end

  # Failed callbacks stay consumed even if the App was removed during verification.
  def discard_oauth_flow
    %i[github_oauth_state github_oauth_verifier github_oauth_started_at github_oauth_generation
      github_oauth_configuration_id github_oauth_credential_revision
      hub_admin_enrollment_proof fresh_authorization_id].each do |key|
      session.delete(key)
    end
  end

  # Returns the saved preview authorization path when it has the expected shape.
  def authentication_return_to
    value = session.delete(:authentication_return_to)
    return if !value.to_s.match?(%r{\A(?:/preview/builds/[1-9]\d*/authorize(?:\?[^\r\n]*)?|/canvas/pair/[0-9A-F]{10})\z})

    value
  end

  # Returns one generic failure that keeps setup and repository state private.
  def authentication_failed
    redirect_to root_path, alert: I18n.t("authentication.failure")
  end

  # Explains that this GitHub account cannot open private Hub pages.
  def access_denied
    redirect_to root_path, alert: I18n.t("authentication.access_denied")
  end
end
