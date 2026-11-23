# Registers an explicitly named target through the workload-owned domain operation.
class TaskApi::RegistrationsController < ActionController::API
  include TaskApiAuthentication

  rate_limit to: 30, within: 1.minute, name: "registration", by: -> { trusted_request_ip },
    with: -> { head :too_many_requests }

  # @route PATCH /api/tasks/prototype/registration (task_api_prototype_registration)
  # @route PUT /api/tasks/prototype/registration (task_api_prototype_registration)
  def update
    credential = connection
    expected_id = params.require(:prototype_id)
    if !expected_id.is_a?(String) && !expected_id.is_a?(Integer) ||
        !expected_id.to_s.match?(/\A[1-9]\d{0,17}\z/)
      raise ActionController::BadRequest
    end

    prototype = credential.repository.prototypes.where(branch_name: credential.branch_name)
      .find(expected_id.to_i)
    result = prototype.register_from_task_connection! \
      connection: credential,
      commit_sha: params.require(:commit_sha)
    render json: result
  end

  private

  def security_audit_action
    "task_registration.update"
  end
end
