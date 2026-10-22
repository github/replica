# Resumes confirmed browser actions through their original permission and mutation paths.
module FreshAuthorizationRequired
  extend ActiveSupport::Concern

  included do
    before_action :restore_authorized_action
    around_action :close_authorization_upload, prepend: true
    rescue_from FreshAuthorization::Continuation::Invalid, with: :continuation_unavailable
  end

  private

  # Supplies the same explicit challenge contract to browser and canvas consumers.
  def require_fresh_authorization(purpose:, return_to: root_path)
    credential = Current.canvas_grant || Current.session
    return true if FreshAuthorization.fresh?(credential)

    record_security_audit(outcome: "denied") if security_audit_action
    pending_action = FreshAuthorization::Continuation.capture(request, params, purpose:) if !Current.canvas_grant
    challenge = FreshAuthorization.start! \
      credential:, purpose:, return_to: Current.canvas_grant ? root_path : return_to, pending_action: pending_action
    url = "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{fresh_authorization_path(challenge.public_id)}"
    if Current.canvas_grant
      render \
        json: {
          code: "fresh_authorization_required",
          errors: [ I18n.t("fresh_authorization.required") ],
          authorization: { url:, expiresAt: challenge.expires_at.iso8601 }
        },
        status: :forbidden
    else
      redirect_to fresh_authorization_path(challenge.public_id), status: :see_other
    end
    false
  rescue FreshAuthorization::Invalid
    if Current.canvas_grant
      render json: { errors: [ I18n.t("fresh_authorization.failure") ] }, status: :unauthorized
    else
      redirect_to root_path, alert: I18n.t("fresh_authorization.failure"), status: :see_other
    end
    false
  end

  # An opaque identifier selects server-saved fields, never replacement client input.
  def restore_authorized_action
    return if !params.key?(:authorization_continuation_id)

    raise FreshAuthorization::Continuation::Invalid if !params[:authorization_continuation_id].is_a?(String)

    challenge = FreshAuthorization.find_by(public_id: params[:authorization_continuation_id])
    raise FreshAuthorization::Continuation::Invalid if challenge.nil?

    attributes = challenge.continuation.claim!(request, browser_session: Current.session)
    if controller_path == "github_app_credentials"
      @authorization_upload = Tempfile.new("replica-credentials")
      @authorization_upload.write(attributes.delete("private_key"))
      @authorization_upload.rewind
      attributes["private_key"] = ActionDispatch::Http::UploadedFile.new(
        tempfile: @authorization_upload, filename: "private-key.pem", type: "application/x-pem-file"
      )
    end
    self.params = ActionController::Parameters.new(request.path_parameters).merge(attributes)
  end

  def close_authorization_upload
    yield
  ensure
    @authorization_upload&.close!
  end

  def continuation_unavailable
    record_security_audit(outcome: "denied") if security_audit_action
    redirect_to root_path, alert: I18n.t("fresh_authorization.continuation_failed"), status: :see_other
  end
end
