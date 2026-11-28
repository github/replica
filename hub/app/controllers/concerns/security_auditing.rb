# Captures trusted request context and decisions without serializing request data.
module SecurityAuditing
  extend ActiveSupport::Concern
  include TrustedRequestSource

  included do
    around_action :audit_security_request, prepend: true
  end

  private

  # Keeps failures visible even when authentication halts a sensitive request.
  def audit_security_request
    Current.security_audit_context = {
      ip_address: security_audit_ip,
      source: case self.class.module_parent_name
              when "CanvasApi" then "canvas"
              when "TaskApi" then "task"
              else "browser"
              end
    }.merge(SecurityAuditEvent.device_context(request.user_agent))
    yield
    return if response.status == 429 || security_audit_action.nil? || @security_audit_recorded

    outcome = if response.status.in?([ 401, 403, 404, 410 ]) ||
        (response.redirect? && Current.user.nil? && response.location.in?([ root_path, root_url ]))
      "denied"
    elsif response.status >= 400
      "failed"
    end
    record_security_audit(outcome:) if outcome
  rescue ActiveRecord::RecordNotFound,
    ActionController::InvalidAuthenticityToken, HubAdminEnrollment::InvalidProof,
    GithubAppSetup::InvalidState, GithubAppConfiguration::Installation::OwnerMismatch,
    CanvasGrant::Expired => error
    record_security_audit(outcome: "denied") if security_audit_action && !@security_audit_recorded
    raise error
  rescue GithubClient::Error, GithubAppSetup::ExchangeFailed, ActionController::ParameterMissing => error
    record_security_audit(outcome: "failed") if security_audit_action && !@security_audit_recorded
    raise error
  rescue ActiveRecord::RecordInvalid => error
    raise if error.record.is_a?(SecurityAuditEvent)

    record_security_audit(outcome: "failed") if security_audit_action && !@security_audit_recorded
    raise error
  rescue ActiveRecord::RecordNotUnique => error
    record_security_audit(outcome: "failed") if security_audit_action && !@security_audit_recorded
    raise error
  end

  # Each sensitive controller names its own operation instead of deriving it from input.
  def security_audit_action
    nil
  end

  # Forwarded addresses are meaningful only when the socket peer is a trusted proxy.
  def security_audit_ip
    trusted_request_ip
  end

  # Successful local state changes call this inside their transaction.
  def record_security_audit(outcome:, repository: @repository,
    actor: @security_audit_actor || Current.user, context: {})
    return if response.status == 429 || @security_audit_recorded

    SecurityAuditEvent.record! \
      action: security_audit_action,
      outcome:,
      repository:,
      actor:,
      context: (Current.security_audit_context || {}).merge(context)
    @security_audit_recorded = true
  end
end
