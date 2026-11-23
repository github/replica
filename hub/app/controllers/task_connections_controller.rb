# Confirms branch-scoped task access through an ordinary signed-in Hub browser.
class TaskConnectionsController < SuperglueController
  rescue_from TaskConnection::Unauthorized, SessionRevocation::Superseded,
    GithubAppConfiguration::Superseded, with: -> {
      record_security_audit(outcome: "denied")
      head :gone
    }
  rescue_from TaskConnection::Forbidden, with: -> {
    record_security_audit(outcome: "denied")
    head :forbidden
  }
  rescue_from GithubClient::Error, with: -> {
    record_security_audit(outcome: "failed")
    head :service_unavailable
  }

  # @route GET /tasks/approve/:user_code (task_approval)
  def show
    @connection = pending_connection
    require_writer!
  end

  # @route POST /tasks/approve/:user_code (task_approval)
  def approve
    @connection = pending_connection
    @connection.approve!(Current.user, browser_session: Current.session)
    redirect_to task_connections_path,
      notice: t("task_connections.show.approved"),
      status: :see_other
  end

  # @route DELETE /tasks/approve/:user_code (task_approval)
  def cancel
    @connection = pending_connection
    require_writer!
    @connection.revoke!(actor: Current.user, pending_only: true)
    redirect_to task_connections_path,
      notice: t("task_connections.show.denied"),
      status: :see_other
  end

  # @route GET /tasks/connections (task_connections)
  def index
    @connections = TaskConnection.where(approving_user: Current.user, revoked_at: nil)
      .where("expires_at > ?", Time.current).includes(:repository).order(created_at: :desc)
  end

  # @route DELETE /tasks/connections/:id (task_connection)
  def destroy
    TaskConnection.where(approving_user: Current.user).find(params[:id]).revoke!(actor: Current.user)
    redirect_to task_connections_path,
      notice: t("task_connections.index.revoked"),
      status: :see_other
  end

  private

  def security_audit_action
    "task_connection.#{action_name}"
  end

  def pending_connection
    connection = TaskConnection.find_by!(user_code: params[:user_code])
    @repository = connection.repository
    Current.security_audit_context = Current.security_audit_context.merge(task_connection_id: connection.id)
    raise TaskConnection::Unauthorized if !connection.pending?

    connection
  end

  def require_writer!
    raise TaskConnection::Forbidden if !@connection.repository.authorization.authorized?(
      Current.user, minimum: :write, fresh: true
    )
  end
end
