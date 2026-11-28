# Uses task credentials independently of browser Sessions and human canvas grants.
class TaskApi::ConnectionsController < ActionController::API
  include TaskApiAuthentication
  include SecurityRateLimiting

  before_action -> { enforce_security_rate_limit(:task_disconnect, identity: trusted_request_ip) }, only: :destroy

  rate_limit to: 10, within: 1.minute, only: :create, name: "create", by: -> { trusted_request_ip },
    with: -> { head :too_many_requests }
  rate_limit to: 60, within: 1.minute, only: :token, name: "token", by: -> { trusted_request_ip },
    with: -> { head :too_many_requests }
  rate_limit to: 60, within: 1.minute, only: :show, name: "status", by: -> { trusted_request_ip },
    with: -> { head :too_many_requests }

  # Starts a branch request without authenticating a claimed Slack identity.
  # @route POST /api/tasks/connections (task_api_connections)
  def create
    name = params.require(:repository)
    branch = params.require(:branch)
    return head :bad_request if !name.is_a?(String) || !name.match?(%r{\A[^/\s]+/[^/\s]+\z}) ||
      !branch.is_a?(String) || branch.blank? || branch.length > 255

    @repository = Repository.active.where("LOWER(name_with_owner) = ?", name.downcase).first!
    connection, device_code = TaskConnection.start!(@repository, branch_name: branch)
    render json: {
      deviceCode: device_code, userCode: connection.user_code,
      verificationUrl: "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{task_approval_path(connection.user_code)}",
      expiresAt: connection.approval_expires_at.iso8601, intervalSeconds: 3
    }, status: :created
  end

  # A credential is returned only to the holder of the private one-use proof.
  # @route POST /api/tasks/connections/token (task_api_connections_token)
  def token
    status, credentials = TaskConnection.consume(params.require(:device_code))
    record_security_audit(outcome: "denied") if status.in?(%w[denied expired])
    render json: (credentials || {}).merge(status:)
  end

  # Returns only the authenticated task's immutable scope and approval deadline.
  # @route GET /api/tasks/connection (task_api_connection)
  def show
    connection.with_publication_authorization! { |live| render json: live.credentials }
  end

  # Explicit disconnect stops future calls without changing retained attribution.
  # @route DELETE /api/tasks/connection (task_api_connection)
  def destroy
    connection.revoke!
    head :no_content
  end

  private

  def security_audit_action
    "task_connection.#{action_name}"
  end
end
