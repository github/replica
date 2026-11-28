# Resolves only the approved branch without exposing general repository contents.
class TaskApi::PrototypesController < ActionController::API
  include TaskApiAuthentication

  rate_limit to: 60, within: 1.minute, name: "lookup", by: -> { trusted_request_ip },
    with: -> { head :too_many_requests }

  # @route GET /api/tasks/prototype (task_api_prototype)
  def show
    connection.with_publication_authorization! do |live|
      prototype = live.repository.reviewable_prototypes.active.find_by(branch_name: live.branch_name)
      render json: {
        repositoryGitHubId: live.repository.github_id,
        branch: live.branch_name,
        prototypeId: prototype&.id
      }
    end
  end

  private

  def security_audit_action
    "task_prototype.lookup"
  end
end
