# Lets Hub administrators connect Copilot with the credential the operator configured, see who
# connected it, and disconnect it. Both changes need fresh GitHub proof, like Hub's other
# administrator settings. Hub keeps no Copilot credential; see CopilotConnection.
class CopilotConnectionsController < SuperglueController
  include FreshAuthorizationRequired

  before_action :require_github_hub
  before_action :authorize_admin
  before_action :confirm_change, only: %i[create destroy]
  before_action :authorize_connect, only: :create
  before_action :authorize_disconnect, only: :destroy

  rescue_from CopilotConnection::ChangeDenied, with: :change_denied
  rescue_from FreshAuthorization::Invalid, with: :authorization_expired

  # @route GET /copilot (copilot_connection)
  def show
    @connection = CopilotConnection.current
    record_security_audit(outcome: "succeeded")
  end

  # @route POST /copilot (copilot_connection)
  def create
    CopilotConnection.connect!(actor: Current.user, browser_session: Current.session)
    @security_audit_recorded = true
    redirect_to copilot_connection_path, notice: t("copilot_connection.connected"), status: :see_other
  rescue CopilotConnection::Refused, Learning::Error => error
    reason, outcome = case error
    when CopilotConnection::PermissionMissing then [ :permission_missing, "denied" ]
    when CopilotConnection::Refused then [ :refused, "denied" ]
    else [ error.code == "not_installed" ? :not_installed : :unavailable, "failed" ]
    end
    record_security_audit(outcome:)
    redirect_to copilot_connection_path, alert: helpers.copilot_billing_t("errors.#{reason}"), status: :see_other
  end

  # @route DELETE /copilot (copilot_connection)
  def destroy
    CopilotConnection.disconnect!(actor: Current.user, browser_session: Current.session)
    @security_audit_recorded = true
    redirect_to copilot_connection_path, notice: t("copilot_connection.disconnected"), status: :see_other
  end

  private

  # Local development has no Copilot credential, so it uses the developer's own Copilot sign-in instead.
  def require_github_hub
    head :not_found if LocalDevelopment.enabled?
  end

  # Check the saved role before showing the connection or starting a GitHub check.
  def authorize_admin
    return if User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?

    record_security_audit(outcome: "denied")
    @access_denied = true
    flash.now[:alert] = t("copilot_connection.errors.not_authorized")
    render :show, status: :forbidden
  end

  def confirm_change
    return if params[:confirmed] == "1"

    change_denied(CopilotConnection::ChangeDenied.new(:confirmation_required))
  end

  def authorize_connect
    require_fresh_authorization purpose: :copilot_connection, return_to: copilot_connection_path
  end

  def authorize_disconnect
    require_fresh_authorization purpose: :copilot_disconnection, return_to: copilot_connection_path
  end

  def security_audit_action
    { "show" => "copilot_connection.view", "create" => "copilot_connection.connect",
      "destroy" => "copilot_connection.disconnect" }.fetch(action_name, nil)
  end

  def change_denied(error)
    record_security_audit(outcome: "denied", actor: User.find_by(id: Current.user.id))
    if error.reason == :not_authorized
      @access_denied = true
      flash.now[:alert] = t("copilot_connection.errors.not_authorized")
      render :show, status: :forbidden
    else
      redirect_to \
        copilot_connection_path,
        alert: helpers.copilot_billing_t("errors.#{error.reason}"),
        status: :see_other
    end
  end

  def authorization_expired
    record_security_audit(outcome: "denied")
    redirect_to copilot_connection_path, alert: t("fresh_authorization.required"), status: :see_other
  end
end
