# Revokes the grant used by this extension without relying on a browser session.
class CanvasApi::ConnectionsController < CanvasApi::BaseController
  skip_before_action :authorize_repository, only: :destroy

  # @route GET /api/canvas/connection (canvas_api_connection)
  def show
    render json: {
      repository: @repository.name_with_owner,
      repositoryId: @repository.route_id,
      canPublish: @repository.authorization.sufficient?(@repository_permission, minimum: :write),
      canReviewFeedback: @repository.authorization.sufficient?(@repository_permission, minimum: :maintain),
      viewerId: Current.user.id,
      viewerLogin: Current.user.login
    }
  end

  # @route PATCH /api/canvas/connection (canvas_api_connection)
  def update
    Current.canvas_grant.record_activity!
    head :no_content
  end

  # @route DELETE /api/canvas/connection (canvas_api_connection)
  def destroy
    Current.canvas_grant.revoke!
    head :no_content
  end

  private

  def security_audit_action
    { "destroy" => "canvas_connection.revoke", "update" => "canvas_connection.activity" }[action_name]
  end
end
