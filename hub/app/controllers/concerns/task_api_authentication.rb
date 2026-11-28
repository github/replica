# Keeps task credentials separate from browser sessions and human canvas grants.
module TaskApiAuthentication
  extend ActiveSupport::Concern
  include SecurityAuditing

  included do
    before_action { response.headers["Cache-Control"] = "private, no-store" }

    rescue_from TaskConnection::Unauthorized, SessionRevocation::Superseded,
      GithubAppConfiguration::Superseded, with: -> {
        record_security_audit(outcome: "denied")
        head :unauthorized
      }
    rescue_from TaskConnection::Forbidden, with: -> {
      record_security_audit(outcome: "denied")
      head :forbidden
    }
    rescue_from GithubClient::Error, with: -> {
      record_security_audit(outcome: "failed")
      head :service_unavailable
    }
    rescue_from ActiveRecord::RecordInvalid, with: ->(error) {
      raise error if error.record.is_a?(SecurityAuditEvent)

      record_security_audit(outcome: "failed")
      head :unprocessable_entity
    }
  end

  private

  def connection
    @connection ||= begin
      header = request.headers["Authorization"].to_s
      secret = header.delete_prefix("Bearer ") if header.start_with?("Bearer ")
      credential = TaskConnection.authenticate(secret) || raise(TaskConnection::Unauthorized)
      @repository = credential.repository
      Current.security_audit_context = Current.security_audit_context.merge(task_connection_id: credential.id)
      credential
    end
  end
end
