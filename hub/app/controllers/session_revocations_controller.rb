# Ends deployment authentication without changing repository or public-share policy.
class SessionRevocationsController < SuperglueController
  include FreshAuthorizationRequired

  before_action :authorize_admin
  before_action :confirm_revocation, only: :create
  before_action :authorize_sensitive_action, only: :create

  rescue_from User::AdminRoleChangeDenied, with: :access_denied
  rescue_from FreshAuthorization::Invalid, with: :authorization_expired
  rescue_from ActiveRecord::RecordInvalid, with: :save_failed

  # @route GET /session_revocation (session_revocation)
  def show
    @browser_count = Session.count
    @canvas_count = CanvasGrant.current.count
    @task_count = TaskConnection.where(revoked_at: nil).where.not(approved_at: nil)
      .where("expires_at > ?", Time.current).count
    @pairing_count = CanvasPairing.where(consumed_at: nil).where("expires_at > ?", Time.current).count
    @pairing_count += TaskConnection.where(approved_at: nil, revoked_at: nil)
      .where("approval_expires_at > ?", Time.current).count
    record_security_audit(outcome: "succeeded")
  end

  # @route POST /session_revocation (session_revocation)
  def create
    actor = Current.user
    audit_context = Current.security_audit_context.merge(session_id: Current.session.id)
    credentials = SessionRevocation.end_all!(actor:, browser_session: Current.session)
    @security_audit_recorded = true
    @ended = true
    Current.session = nil
    reset_session
    disconnect(credentials, actor: actor, audit_context: audit_context)
    render :show
  end

  private

  # Matches Hub administrator management's persisted, GitHub-backed role guard.
  def authorize_admin
    return if User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?

    access_denied
  end

  def confirm_revocation
    if params[:cancelled] == "1"
      record_security_audit(outcome: "denied")
      redirect_to session_revocation_path, notice: t("session_revocation.cancelled"), status: :see_other
    elsif params[:confirmed] != "1"
      record_security_audit(outcome: "denied")
      redirect_to session_revocation_path, alert: t("session_revocation.confirmation_required"), status: :see_other
    end
  end

  def authorize_sensitive_action
    require_fresh_authorization \
      purpose: :session_revocation, return_to: session_revocation_path
  end

  def security_audit_action
    action_name == "create" ? "session_revocation.end_all" : "session_revocation.view"
  end

  def access_denied(_error = nil)
    record_security_audit(outcome: "denied")
    @access_denied = true
    flash.now[:alert] = t("session_revocation.not_authorized")
    render :show, status: :forbidden
  end

  def authorization_expired
    record_security_audit(outcome: "denied")
    redirect_to session_revocation_path, alert: t("fresh_authorization.required"), status: :see_other
  end

  def save_failed(error)
    raise error if error.record.is_a?(SecurityAuditEvent)

    record_security_audit(outcome: "failed")
    redirect_to session_revocation_path, alert: t("session_revocation.save_failed"), status: :see_other
  end

  # The database cutoff remains effective even if the cable transport is unavailable.
  def disconnect(credentials, actor:, audit_context:)
    SessionRevocation.disconnect!(credentials)
  rescue ActiveRecord::ActiveRecordError, IOError, SystemCallError, Timeout::Error
    @disconnect_failed = true
    SecurityAuditEvent.record! \
      action: "session_revocation.disconnect", outcome: "failed", actor: actor,
      context: audit_context
    Rails.logger.error("Session revocation committed; live disconnect delivery failed.")
  end
end
